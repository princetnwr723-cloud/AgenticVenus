// lib/browserUse.ts
// Real browser automation via Browserless — connects a remote Chrome over CDP
// with the user's own token.
//
// CAPTCHA / "I'm not a robot" FIX
//  Browserless's plain connection endpoint has no anti-detection at all, so
//  ordinary automated traffic (especially hitting Google search directly)
//  reliably tripped bot-checks. Two real Browserless features fix this:
//   - the `/stealth` route: fingerprint randomization + automation-signal
//     hiding (free, no extra cost)
//   - `solveCaptchas=true`: Browserless detects and solves reCAPTCHA /
//     Cloudflare / hCaptcha challenges INSIDE the session automatically.
//     Per Browserless's own docs this only bills (a small per-solve unit
//     cost) on a SUCCESSFUL solve — a challenge it can't clear costs nothing.
//  Combined with defaulting web searches to DuckDuckGo instead of Google
//  (already the default below — Google is by far the most aggressive at
//  flagging automated traffic), this is what actually gets past the
//  checkbox/captcha wall instead of getting stuck on it.
//
// SESSION LENGTH
//  Browserless session/reconnect limits are plan-based (free plan: ~1-2
//  minutes; paid plans scale up to 30-60 minutes). We now explicitly ask for
//  a 30-minute session and a 30-minute reconnect window on every connection —
//  Browserless silently caps this to whatever the account's plan actually
//  allows, so this is always safe to request regardless of plan.
//
// WHY THE AGENT USED TO CLICK BELOW THE SEARCH ICON (kept from the previous
// fix): the viewport is pinned to 1280x800 at deviceScaleFactor 1, so
// screenshot pixels always equal page pixels, and every action response also
// returns a numbered map of the visible clickable elements with their real
// centre coordinates so the model can say "click element 7" instead of
// guessing pixels.

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { adminDb } from "@/lib/firebaseAdmin";

const REGION = "production-sfo.browserless.io";
// Requested session/reconnect length — Browserless clamps this to the
// account's actual plan limit, so asking for the max is always safe.
const REQUESTED_SESSION_MS = 30 * 60 * 1000;
const NAV_TIMEOUT_MS = 45_000; // generous — captcha-solving needs real time to run

export const BROWSER_VIEWPORT = { width: 1280, height: 800 };

export type BrowserElement = {
  index: number;
  tag: string;
  label: string;
  type?: string;
  x: number; // centre, in screenshot pixels
  y: number;
  w: number;
  h: number;
};

export type SearchEngine = "duckduckgo" | "google" | "bing";

export type BrowserAction =
  | { type: "screenshot" }
  | { type: "goto"; url: string }
  | { type: "search"; query: string; engine?: SearchEngine }
  | { type: "back" }
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "type"; text: string; submit?: boolean; clear?: boolean }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
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
  /** Heuristic: the page looks like a bot-check/captcha wall right now. */
  captchaLikely?: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function connectionUrl(apiKey: string, extra = ""): string {
  // /stealth = anti-detection route. solveCaptchas=true = automatic
  // challenge solving (billed only when it actually solves one).
  return `wss://${REGION}/stealth?token=${apiKey}&solveCaptchas=true&timeout=${REQUESTED_SESSION_MS}${extra}`;
}

async function saveSession(uid: string, sessionId: string, reconnectEndpoint: string) {
  await adminDb().collection("users").doc(uid).collection("browserSessions").doc(sessionId).set({
    reconnectEndpoint,
    createdAt: Date.now(),
  });
}

async function loadReconnectEndpoint(uid: string, sessionId: string): Promise<string> {
  const snap = await adminDb().collection("users").doc(uid).collection("browserSessions").doc(sessionId).get();
  if (!snap.exists) throw new Error("Browser session not found or expired.");
  return snap.data()!.reconnectEndpoint as string;
}

/** Calls Browserless.reconnect on an already-connected browser and returns a
 * fresh, token-bearing endpoint — requests the full 30 minutes; Browserless
 * clamps this to whatever the plan actually allows. */
async function refreshReconnectEndpoint(browser: Browser, apiKey: string): Promise<string> {
  const page = (await browser.pages())[0] || (await browser.newPage());
  const cdp = await page.createCDPSession();
  const { error, browserWSEndpoint } = (await cdp.send("Browserless.reconnect" as any, {
    timeout: REQUESTED_SESSION_MS,
  } as any)) as { error?: string; browserWSEndpoint?: string };
  if (error || !browserWSEndpoint) throw new Error(error || "Browserless didn't return a reconnect endpoint.");
  return `${browserWSEndpoint}?token=${apiKey}&solveCaptchas=true`;
}

/** The page the user/agent is actually looking at (popups open new tabs), with
 * the viewport pinned so screenshot pixels always equal page pixels. */
async function activePage(browser: Browser): Promise<Page> {
  const pages = await browser.pages();
  const page = pages[pages.length - 1] || (await browser.newPage());
  await page.setViewport({ ...BROWSER_VIEWPORT, deviceScaleFactor: 1 }).catch(() => undefined);
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);
  return page;
}

async function settle(page: Page, extraMs = 500) {
  await page.waitForNetworkIdle({ idleTime: 350, timeout: 5000 }).catch(() => undefined);
  await sleep(extraMs);
}

/** Cheap heuristic so the agent (and its prompt) can tell it hit a bot-check
 * wall rather than the real page, and know to just wait rather than give up. */
async function detectCaptcha(page: Page): Promise<boolean> {
  try {
    return await page.evaluate(() => {
      const text = (document.body?.innerText || "").toLowerCase();
      const hasFrame = !!document.querySelector('iframe[src*="recaptcha"],iframe[src*="hcaptcha"],iframe[title*="challenge"],#turnstile-wrapper,.cf-turnstile');
      const hasText = /unusual traffic|i'm not a robot|verify you are human|checking your browser|complete the security check/.test(text);
      return hasFrame || hasText;
    });
  } catch {
    return false;
  }
}

/** Numbered list of visible, really-clickable elements, with live centre points. */
async function collectElements(page: Page): Promise<BrowserElement[]> {
  try {
    const found = await page.evaluate(() => {
      const selector =
        'a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=switch],[role=combobox],[role=searchbox],[contenteditable=""],[contenteditable="true"],[onclick],[tabindex]:not([tabindex="-1"])';
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const out: { tag: string; label: string; type?: string; x: number; y: number; w: number; h: number }[] = [];
      const seen = new Set<Element>();

      for (const el of Array.from(document.querySelectorAll(selector))) {
        if (out.length >= 70) break;
        const r = el.getBoundingClientRect();
        if (r.width < 4 || r.height < 4) continue;
        if (r.bottom < 0 || r.right < 0 || r.top > vh || r.left > vw) continue;
        const cs = getComputedStyle(el);
        if (cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) === 0) continue;

        const cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
        const cy = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1);
        const top = document.elementFromPoint(cx, cy);
        if (!top || !(el === top || el.contains(top) || top.contains(el))) continue; // covered by something else

        // skip wrappers that duplicate an already-listed parent of the same size
        let parent = el.parentElement;
        let duplicate = false;
        while (parent) {
          if (seen.has(parent)) {
            const pr = parent.getBoundingClientRect();
            if (Math.abs(pr.width - r.width) < 8 && Math.abs(pr.height - r.height) < 8) duplicate = true;
            break;
          }
          parent = parent.parentElement;
        }
        if (duplicate) continue;
        seen.add(el);

        const html = el as HTMLElement;
        const input = el as HTMLInputElement;
        const idOrClass = el.id || (typeof html.className === "string" ? html.className.split(" ")[0] : "");
        const label = (
          el.getAttribute("aria-label") ||
          html.innerText ||
          el.getAttribute("placeholder") ||
          el.getAttribute("title") ||
          input.value ||
          el.getAttribute("alt") ||
          el.querySelector("img")?.getAttribute("alt") ||
          el.querySelector("svg title")?.textContent ||
          el.getAttribute("name") ||
          (idOrClass ? `icon:${idOrClass}` : "icon")
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 70);

        out.push({
          tag: el.tagName.toLowerCase(),
          label,
          type: el.tagName === "INPUT" ? input.type : undefined,
          x: Math.round(cx),
          y: Math.round(cy),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      }
      return out;
    });
    return found.map((e, i) => ({ index: i + 1, ...e }));
  } catch {
    return [];
  }
}

async function pressCombo(page: Page, combo: string) {
  const parts = combo.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) {
    await page.keyboard.press((parts[0] || combo) as any);
    return;
  }
  const key = parts[parts.length - 1];
  const mods = parts.slice(0, -1);
  for (const m of mods) await page.keyboard.down(m as any);
  await page.keyboard.press((key.length === 1 ? `Key${key.toUpperCase()}` : key) as any);
  for (const m of mods.reverse()) await page.keyboard.up(m as any);
}

function searchUrl(query: string, engine: SearchEngine = "duckduckgo"): string {
  const q = encodeURIComponent(query);
  if (engine === "google") return `https://www.google.com/search?q=${q}`;
  if (engine === "bing") return `https://www.bing.com/search?q=${q}`;
  return `https://duckduckgo.com/?q=${q}&ia=web`;
}

export async function startBrowserSession(
  uid: string,
  apiKey: string,
  profileName?: string
): Promise<{ sessionId: string; liveUrl: string; profileName?: string }> {
  const profile = profileName ? `&profile=${encodeURIComponent(profileName)}` : "";
  const browser = await puppeteer.connect({ browserWSEndpoint: connectionUrl(apiKey, profile) });
  await activePage(browser);

  const reconnectEndpoint = await refreshReconnectEndpoint(browser, apiKey);
  const sessionId = crypto.randomUUID();
  await saveSession(uid, sessionId, reconnectEndpoint);

  let liveUrl = "";
  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    const cdp = await page.createCDPSession();
    const live = (await cdp.send("Browserless.liveURL" as any, {
      timeout: REQUESTED_SESSION_MS,
      interactable: true,
      resizable: true,
      showBrowserInterface: true,
      quality: 70,
      type: "jpeg",
    } as any)) as { error?: string; liveURL?: string };
    if (!live.error) liveUrl = live.liveURL || "";
  } catch {
    // Live view is best-effort; the agent can still automate the browser.
  }

  await browser.disconnect();
  return { sessionId, liveUrl, profileName };
}

export async function runBrowserAction(
  uid: string,
  sessionId: string,
  action: BrowserAction,
  apiKey: string
): Promise<BrowserActionResult> {
  const reconnectEndpoint = await loadReconnectEndpoint(uid, sessionId);
  const browser: Browser = await puppeteer.connect({ browserWSEndpoint: reconnectEndpoint });
  try {
    const page = await activePage(browser);
    let extracted: string | undefined;

    switch (action.type) {
      case "goto": {
        const url = /^https?:\/\//i.test(action.url) ? action.url : `https://${action.url}`;
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
        await settle(page);
        break;
      }
      case "search": {
        await page
          .goto(searchUrl(action.query, action.engine), { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS })
          .catch(() => undefined);
        await settle(page, 800);
        break;
      }
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS }).catch(() => undefined);
        await settle(page);
        break;
      case "click": {
        await page.mouse.move(action.x, action.y);
        await sleep(80);
        await page.mouse.click(action.x, action.y, {
          button: action.button || "left",
          clickCount: action.double ? 2 : 1,
        });
        await settle(page, 400);
        break;
      }
      case "type": {
        if (action.clear) {
          await page.keyboard.down("Control");
          await page.keyboard.press("KeyA");
          await page.keyboard.up("Control");
          await page.keyboard.press("Backspace");
        }
        await page.keyboard.type(action.text, { delay: 12 });
        if (action.submit) {
          await page.keyboard.press("Enter");
          await settle(page, 600);
        } else {
          await sleep(300);
        }
        break;
      }
      case "key":
        await pressCombo(page, action.key);
        await settle(page, 300);
        break;
      case "scroll": {
        await page.mouse.move(BROWSER_VIEWPORT.width / 2, BROWSER_VIEWPORT.height / 2);
        await page.mouse.wheel({ deltaY: action.amount });
        await sleep(450);
        break;
      }
      case "extractText":
        extracted = (await page.evaluate(() => document.body?.innerText || "")).replace(/\n{3,}/g, "\n\n").slice(0, 9000);
        break;
      case "wait":
        // Captchas can take Browserless's auto-solver 15-30s — allow a longer wait than before.
        await sleep(Math.min(action.ms, 30000));
        break;
      case "screenshot":
        break;
    }

    const captchaLikely = await detectCaptcha(page);
    const shot = (await page.screenshot({
      encoding: "base64",
      type: "jpeg",
      quality: 70,
      captureBeyondViewport: false,
    })) as string;
    const elements = await collectElements(page);
    const viewport = page.viewport() || BROWSER_VIEWPORT;

    // Renew the session's timeout on every real action.
    const fresh = await refreshReconnectEndpoint(browser, apiKey);
    await saveSession(uid, sessionId, fresh);

    return {
      screenshotBase64: shot,
      text: extracted,
      elements,
      url: page.url(),
      title: await page.title().catch(() => ""),
      width: viewport.width,
      height: viewport.height,
      captchaLikely,
    };
  } finally {
    await browser.disconnect();
  }
}

export async function stopBrowserSession(uid: string, sessionId: string): Promise<void> {
  try {
    const reconnectEndpoint = await loadReconnectEndpoint(uid, sessionId);
    const browser = await puppeteer.connect({ browserWSEndpoint: reconnectEndpoint });
    await browser.close();
  } catch {
    // best-effort
  } finally {
    await adminDb().collection("users").doc(uid).collection("browserSessions").doc(sessionId).delete().catch(() => null);
  }
}