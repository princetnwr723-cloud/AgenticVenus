// lib/browserUse.ts
// Real browser automation via Browserless.
// Persistent Browserless session + reconnect + live view.

import puppeteer, {
  type Browser,
  type Page,
} from "puppeteer-core";
import { adminDb } from "@/lib/firebaseAdmin";

const REGION = "production-sfo.browserless.io";

const REQUESTED_SESSION_MS = 30 * 60 * 1000;
const NAV_TIMEOUT_MS = 45_000;

export const BROWSER_VIEWPORT = {
  width: 1280,
  height: 800,
};

export type BrowserElement = {
  index: number;
  tag: string;
  label: string;
  type?: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export type SearchEngine =
  | "duckduckgo"
  | "google"
  | "bing";

export type BrowserAction =
  | { type: "screenshot" }
  | { type: "goto"; url: string }
  | {
      type: "search";
      query: string;
      engine?: SearchEngine;
    }
  | { type: "back" }
  | {
      type: "click";
      x: number;
      y: number;
      button?: "left" | "right" | "middle";
      double?: boolean;
    }
  | {
      type: "type";
      text: string;
      submit?: boolean;
      clear?: boolean;
    }
  | {
      type: "key";
      key: string;
    }
  | {
      type: "scroll";
      amount: number;
    }
  | { type: "extractText" }
  | { type: "wait"; ms: number };

export type BrowserActionResult = {
  screenshotBase64?: string;
  text?: string;
  elements?: BrowserElement[];
  url?: string;
  title?: string;
  width: number;
  height: number;
  captchaLikely?: boolean;
};

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function normalizeApiKey(apiKey: string): string {
  const key = String(apiKey || "").trim();

  if (!key) {
    throw new Error("BROWSERLESS_KEY_MISSING");
  }

  return key;
}

function connectionUrl(
  apiKey: string,
  extra = ""
): string {
  const key = normalizeApiKey(apiKey);

  return (
    `wss://${REGION}/stealth` +
    `?token=${encodeURIComponent(key)}` +
    `&solveCaptchas=true` +
    `&timeout=${REQUESTED_SESSION_MS}` +
    extra
  );
}

async function saveSession(
  uid: string,
  sessionId: string,
  reconnectEndpoint: string
) {
  await adminDb()
    .collection("users")
    .doc(uid)
    .collection("browserSessions")
    .doc(sessionId)
    .set({
      reconnectEndpoint,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
}

async function loadReconnectEndpoint(
  uid: string,
  sessionId: string
): Promise<string> {
  const snap = await adminDb()
    .collection("users")
    .doc(uid)
    .collection("browserSessions")
    .doc(sessionId)
    .get();

  if (!snap.exists) {
    throw new Error(
      "Browser session not found or expired."
    );
  }

  const endpoint = snap.data()?.reconnectEndpoint;

  if (
    typeof endpoint !== "string" ||
    !endpoint.trim()
  ) {
    throw new Error(
      "Browser session has no reconnect endpoint."
    );
  }

  return endpoint;
}

/**
 * Ask Browserless for a fresh reconnect endpoint.
 */
async function refreshReconnectEndpoint(
  browser: Browser,
  apiKey: string
): Promise<string> {
  const page =
    (await browser.pages())[0] ||
    (await browser.newPage());

  const cdp = await page.createCDPSession();

  try {
    const response = (await cdp.send(
      "Browserless.reconnect" as any,
      {
        timeout: REQUESTED_SESSION_MS,
      } as any
    )) as {
      error?: string;
      browserWSEndpoint?: string;
    };

    if (
      response.error ||
      !response.browserWSEndpoint
    ) {
      throw new Error(
        response.error ||
          "Browserless did not return a reconnect endpoint."
      );
    }

    const endpoint =
      response.browserWSEndpoint;

    // Some Browserless responses already contain a query string.
    if (endpoint.includes("?")) {
      return `${endpoint}&token=${encodeURIComponent(
        normalizeApiKey(apiKey)
      )}`;
    }

    return `${endpoint}?token=${encodeURIComponent(
      normalizeApiKey(apiKey)
    )}`;
  } finally {
    await cdp.detach().catch(() => undefined);
  }
}

/**
 * Get the active page.
 */
async function activePage(
  browser: Browser
): Promise<Page> {
  const pages = await browser.pages();

  const page =
    pages[pages.length - 1] ||
    (await browser.newPage());

  await page
    .setViewport({
      ...BROWSER_VIEWPORT,
      deviceScaleFactor: 1,
    })
    .catch(() => undefined);

  page.setDefaultNavigationTimeout(
    NAV_TIMEOUT_MS
  );

  page.setDefaultTimeout(
    NAV_TIMEOUT_MS
  );

  return page;
}

async function settle(
  page: Page,
  extraMs = 500
) {
  await page
    .waitForNetworkIdle({
      idleTime: 350,
      timeout: 5000,
    })
    .catch(() => undefined);

  await sleep(extraMs);
}

/**
 * Detect common captcha / bot-check pages.
 */
async function detectCaptcha(
  page: Page
): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const text = (
        document.body?.innerText || ""
      ).toLowerCase();

      const hasFrame = !!document.querySelector(
        [
          'iframe[src*="recaptcha"]',
          'iframe[src*="hcaptcha"]',
          'iframe[title*="challenge"]',
          "#turnstile-wrapper",
          ".cf-turnstile",
        ].join(",")
      );

      const hasText =
        /unusual traffic|i'm not a robot|verify you are human|checking your browser|complete the security check|access denied/.test(
          text
        );

      return hasFrame || hasText;
    });
  } catch {
    return false;
  }
}

/**
 * Collect visible clickable/input elements.
 */
async function collectElements(
  page: Page
): Promise<BrowserElement[]> {
  try {
    const found = await page.evaluate(() => {
      const selector = [
        "a[href]",
        "button",
        'input:not([type="hidden"])',
        "textarea",
        "select",
        "summary",
        '[role="button"]',
        '[role="link"]',
        '[role="tab"]',
        '[role="menuitem"]',
        '[role="checkbox"]',
        '[role="switch"]',
        '[role="combobox"]',
        '[role="searchbox"]',
        '[contenteditable=""]',
        '[contenteditable="true"]',
        "[onclick]",
        '[tabindex]:not([tabindex="-1"])',
      ].join(",");

      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const out: {
        tag: string;
        label: string;
        type?: string;
        x: number;
        y: number;
        w: number;
        h: number;
      }[] = [];

      const seen = new Set<Element>();

      for (const el of Array.from(
        document.querySelectorAll(selector)
      )) {
        if (out.length >= 70) break;

        const rect =
          el.getBoundingClientRect();

        if (
          rect.width < 4 ||
          rect.height < 4
        ) {
          continue;
        }

        if (
          rect.bottom < 0 ||
          rect.right < 0 ||
          rect.top > vh ||
          rect.left > vw
        ) {
          continue;
        }

        const style =
          window.getComputedStyle(el);

        if (
          style.visibility === "hidden" ||
          style.display === "none" ||
          Number(style.opacity) === 0
        ) {
          continue;
        }

        const cx = Math.min(
          Math.max(
            rect.left + rect.width / 2,
            1
          ),
          vw - 1
        );

        const cy = Math.min(
          Math.max(
            rect.top + rect.height / 2,
            1
          ),
          vh - 1
        );

        const top =
          document.elementFromPoint(
            cx,
            cy
          );

        if (
          !top ||
          !(
            el === top ||
            el.contains(top) ||
            top.contains(el)
          )
        ) {
          continue;
        }

        let parent =
          el.parentElement;

        let duplicate = false;

        while (parent) {
          if (seen.has(parent)) {
            const parentRect =
              parent.getBoundingClientRect();

            if (
              Math.abs(
                parentRect.width -
                  rect.width
              ) < 8 &&
              Math.abs(
                parentRect.height -
                  rect.height
              ) < 8
            ) {
              duplicate = true;
            }

            break;
          }

          parent =
            parent.parentElement;
        }

        if (duplicate) continue;

        seen.add(el);

        const html =
          el as HTMLElement;

        const input =
          el as HTMLInputElement;

        const className =
          typeof html.className ===
          "string"
            ? html.className
                .split(" ")[0]
            : "";

        const idOrClass =
          el.id || className;

        const label = (
          el.getAttribute(
            "aria-label"
          ) ||
          html.innerText ||
          el.getAttribute(
            "placeholder"
          ) ||
          el.getAttribute(
            "title"
          ) ||
          input.value ||
          el.getAttribute("alt") ||
          el
            .querySelector("img")
            ?.getAttribute("alt") ||
          el
            .querySelector("svg title")
            ?.textContent ||
          el.getAttribute("name") ||
          (idOrClass
            ? `icon:${idOrClass}`
            : "icon")
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 70);

        out.push({
          tag:
            el.tagName.toLowerCase(),
          label,
          type:
            el.tagName === "INPUT"
              ? input.type
              : undefined,
          x: Math.round(cx),
          y: Math.round(cy),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        });
      }

      return out;
    });

    return found.map((element, index) => ({
      index: index + 1,
      ...element,
    }));
  } catch {
    return [];
  }
}

async function pressCombo(
  page: Page,
  combo: string
) {
  const parts = combo
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);

  if (parts.length <= 1) {
    await page.keyboard.press(
      (parts[0] || combo) as any
    );

    return;
  }

  const key =
    parts[parts.length - 1];

  const modifiers =
    parts.slice(0, -1);

  for (const modifier of modifiers) {
    await page.keyboard.down(
      modifier as any
    );
  }

  const normalizedKey =
    key.length === 1
      ? `Key${key.toUpperCase()}`
      : key;

  await page.keyboard.press(
    normalizedKey as any
  );

  for (
    const modifier of [...modifiers].reverse()
  ) {
    await page.keyboard.up(
      modifier as any
    );
  }
}

function searchUrl(
  query: string,
  engine: SearchEngine = "duckduckgo"
): string {
  const encoded =
    encodeURIComponent(query);

  if (engine === "google") {
    return `https://www.google.com/search?q=${encoded}`;
  }

  if (engine === "bing") {
    return `https://www.bing.com/search?q=${encoded}`;
  }

  return `https://duckduckgo.com/?q=${encoded}&ia=web`;
}

/**
 * Start a new Browserless browser session.
 */
export async function startBrowserSession(
  uid: string,
  apiKey: string,
  profileName?: string
): Promise<{
  sessionId: string;
  liveUrl: string;
  profileName?: string;
}> {
  if (!uid) {
    throw new Error(
      "BROWSER_AUTH_REQUIRED"
    );
  }

  const key =
    normalizeApiKey(apiKey);

  const profile =
    profileName?.trim()
      ? `&profile=${encodeURIComponent(
          profileName.trim()
        )}`
      : "";

  let browser: Browser | null = null;

  try {
    browser = await puppeteer.connect({
      browserWSEndpoint:
        connectionUrl(
          key,
          profile
        ),
      protocolTimeout: 60_000,
    });

    await activePage(browser);

    const reconnectEndpoint =
      await refreshReconnectEndpoint(
        browser,
        key
      );

    const sessionId =
      crypto.randomUUID();

    await saveSession(
      uid,
      sessionId,
      reconnectEndpoint
    );

    let liveUrl = "";

    try {
      const page =
        await activePage(browser);

      const cdp =
        await page.createCDPSession();

      try {
        const live =
          (await cdp.send(
            "Browserless.liveURL" as any,
            {
              timeout:
                REQUESTED_SESSION_MS,
              interactable: true,
              resizable: true,
              showBrowserInterface:
                true,
              quality: 70,
              type: "jpeg",
            } as any
          )) as {
            error?: string;
            liveURL?: string;
          };

        if (
          !live.error &&
          live.liveURL
        ) {
          liveUrl =
            live.liveURL;
        }
      } finally {
        await cdp
          .detach()
          .catch(
            () => undefined
          );
      }
    } catch (error) {
      console.warn(
        "[browserUse] live view unavailable:",
        error
      );
    }

    return {
      sessionId,
      liveUrl,
      profileName,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "[browserUse] startBrowserSession failed:",
      error
    );

    throw new Error(
      `Browser start failed: ${message}`
    );
  } finally {
    if (browser) {
      await browser
        .disconnect()
        .catch(
          () => undefined
        );
    }
  }
}

/**
 * Execute one browser action.
 *
 * IMPORTANT:
 * This function is intentionally exported because
 * /api/browser/act/route.ts imports it directly.
 */
export async function runBrowserAction(
  uid: string,
  sessionId: string,
  action: BrowserAction,
  apiKey: string
): Promise<BrowserActionResult> {
  if (!uid) {
    throw new Error(
      "BROWSER_AUTH_REQUIRED"
    );
  }

  if (!sessionId) {
    throw new Error(
      "BROWSER_SESSION_REQUIRED"
    );
  }

  const key =
    normalizeApiKey(apiKey);

  const reconnectEndpoint =
    await loadReconnectEndpoint(
      uid,
      sessionId
    );

  let browser: Browser | null =
    null;

  try {
    browser =
      await puppeteer.connect({
        browserWSEndpoint:
          reconnectEndpoint,
        protocolTimeout: 60_000,
      });

    const page =
      await activePage(browser);

    let extracted:
      | string
      | undefined;

    switch (action.type) {
      case "goto": {
        const url =
          /^https?:\/\//i.test(
            action.url
          )
            ? action.url
            : `https://${action.url}`;

        await page.goto(url, {
          waitUntil:
            "domcontentloaded",
          timeout:
            NAV_TIMEOUT_MS,
        });

        await settle(page);

        break;
      }

      case "search": {
        await page.goto(
          searchUrl(
            action.query,
            action.engine
          ),
          {
            waitUntil:
              "domcontentloaded",
            timeout:
              NAV_TIMEOUT_MS,
          }
        );

        await settle(
          page,
          800
        );

        break;
      }

      case "back": {
        await page
          .goBack({
            waitUntil:
              "domcontentloaded",
            timeout:
              NAV_TIMEOUT_MS,
          })
          .catch(
            () => undefined
          );

        await settle(page);

        break;
      }

      case "click": {
        await page.mouse.move(
          action.x,
          action.y
        );

        await sleep(80);

        await page.mouse.click(
          action.x,
          action.y,
          {
            button:
              action.button ||
              "left",
            clickCount:
              action.double
                ? 2
                : 1,
          }
        );

        await settle(
          page,
          400
        );

        break;
      }

      case "type": {
        if (action.clear) {
          const modifier =
            process.platform ===
            "darwin"
              ? "Meta"
              : "Control";

          await page.keyboard.down(
            modifier
          );

          await page.keyboard.press(
            "KeyA"
          );

          await page.keyboard.up(
            modifier
          );

          await page.keyboard.press(
            "Backspace"
          );
        }

        await page.keyboard.type(
          action.text,
          {
            delay: 12,
          }
        );

        if (action.submit) {
          await page.keyboard.press(
            "Enter"
          );

          await settle(
            page,
            600
          );
        } else {
          await sleep(300);
        }

        break;
      }

      case "key": {
        await pressCombo(
          page,
          action.key
        );

        await settle(
          page,
          300
        );

        break;
      }

      case "scroll": {
        await page.mouse.move(
          BROWSER_VIEWPORT.width /
            2,
          BROWSER_VIEWPORT.height /
            2
        );

        await page.mouse.wheel({
          deltaY:
            action.amount,
        });

        await sleep(450);

        break;
      }

      case "extractText": {
        extracted =
          await page.evaluate(
            () =>
              document.body
                ?.innerText || ""
          );

        extracted =
          extracted
            .replace(
              /\n{3,}/g,
              "\n\n"
            )
            .slice(0, 9000);

        break;
      }

      case "wait": {
        await sleep(
          Math.min(
            Math.max(
              action.ms || 0,
              0
            ),
            30_000
          )
        );

        break;
      }

      case "screenshot": {
        // Screenshot is generated below.
        break;
      }

      default: {
        throw new Error(
          `Unsupported browser action: ${String(
            (action as any).type
          )}`
        );
      }
    }

    const captchaLikely =
      await detectCaptcha(
        page
      );

    const screenshot =
      (await page.screenshot({
        encoding: "base64",
        type: "jpeg",
        quality: 70,
        captureBeyondViewport:
          false,
      })) as string;

    const elements =
      await collectElements(
        page
      );

    const viewport =
      page.viewport() ||
      BROWSER_VIEWPORT;

    // Keep the persistent session alive.
    const fresh =
      await refreshReconnectEndpoint(
        browser,
        key
      );

    await saveSession(
      uid,
      sessionId,
      fresh
    );

    return {
      screenshotBase64:
        screenshot,
      text: extracted,
      elements,
      url: page.url(),
      title:
        await page
          .title()
          .catch(
            () => ""
          ),
      width:
        viewport.width,
      height:
        viewport.height,
      captchaLikely,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "[browserUse] runBrowserAction failed:",
      {
        uid,
        sessionId,
        actionType:
          action?.type,
        error,
      }
    );

    throw new Error(
      `Browser action failed (${action?.type || "unknown"}): ${message}`
    );
  } finally {
    if (browser) {
      await browser
        .disconnect()
        .catch(
          () => undefined
        );
    }
  }
}

/**
 * Stop and delete a browser session.
 */
export async function stopBrowserSession(
  uid: string,
  sessionId: string
): Promise<void> {
  try {
    const reconnectEndpoint =
      await loadReconnectEndpoint(
        uid,
        sessionId
      );

    const browser =
      await puppeteer.connect({
        browserWSEndpoint:
          reconnectEndpoint,
        protocolTimeout: 30_000,
      });

    try {
      await browser.close();
    } catch {
      await browser
        .disconnect()
        .catch(
          () => undefined
        );
    }
  } catch (error) {
    console.warn(
      "[browserUse] stop session failed:",
      error
    );
  } finally {
    await adminDb()
      .collection("users")
      .doc(uid)
      .collection("browserSessions")
      .doc(sessionId)
      .delete()
      .catch(
        () => undefined
      );
  }
}