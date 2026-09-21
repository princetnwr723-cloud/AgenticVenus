// lib/browserUse.ts
// Real browser automation via Browserless — connects a remote Chrome over CDP
// with the user's own token.
//
// WHY THE AGENT USED TO CLICK BELOW THE SEARCH ICON
//  1. The page had no fixed viewport, so the screenshot size was whatever
//     Browserless picked, while the model guessed coordinates for a picture it
//     had silently downscaled. Every click landed off-target.
//  2. The model had to "eyeball" pixel positions from a JPEG.
// FIX
//  - The viewport is pinned to 1280x800 at deviceScaleFactor 1, and the
//    screenshot is exactly that size, so screenshot pixels == page pixels.
//  - After every action we also return a numbered map of the visible,
//    genuinely clickable elements (centre x/y already computed from the live
//    DOM). The model can say "click element 7" and we click its true centre.
//  - New `search` and `back` actions, `type` with submit/clear, real mouse-wheel
//    scrolling, and a settle step so screenshots are taken after the page loads.
//
// SESSION ACROSS SERVERLESS REQUESTS: `Browserless.reconnect` hands back a
// session-specific endpoint that survives a disconnect (max 120s). Every action
// renews it, so an actively used session stays alive.

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { adminDb } from "@/lib/firebaseAdmin";

const REGION = "production-sfo.browserless.io";
const SESSION_TIMEOUT_MS = 110_000; // Browserless's hard cap is 120000ms

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
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
 * fresh, token-bearing endpoint good for another SESSION_TIMEOUT_MS. */
async function refreshReconnectEndpoint(browser: Browser, apiKey: string): Promise<string> {
  const page = (await browser.pages())[0] || (await browser.newPage());
  const cdp = await page.createCDPSession();
  const { error, browserWSEndpoint } = (await cdp.send("Browserless.reconnect" as any, {
    timeout: SESSION_TIMEOUT_MS,
  } as any)) as { error?: string; browserWSEndpoint?: string };
  if (error || !browserWSEndpoint) throw new Error(error || "Browserless didn't return a reconnect endpoint.");
  return `${browserWSEndpoint}?token=${apiKey}`;
}

/** The page the user/agent is actually looking at (popups open new tabs), with
 * the viewport pinned so screenshot pixels always equal page pixels. */
async function activePage(browser: Browser): Promise<Page> {
  const pages = await browser.pages();
  const page = pages[pages.length - 1] || (await browser.newPage());
  await page.setViewport({ ...BROWSER_VIEWPORT, deviceScaleFactor: 1 }).catch(() => undefined);
  return page;
}

async function settle(page: Page, extraMs = 500) {
  await page.waitForNetworkIdle({ idleTime: 350, timeout: 4000 }).catch(() => undefined);
  await sleep(extraMs);
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
  const browser = await puppeteer.connect({ browserWSEndpoint: `wss://${REGION}/?token=${apiKey}${profile}` });
  await activePage(browser);

  const reconnectEndpoint = await refreshReconnectEndpoint(browser, apiKey);
  const sessionId = crypto.randomUUID();
  await saveSession(uid, sessionId, reconnectEndpoint);

  let liveUrl = "";
  try {
    const page = (await browser.pages())[0] || (await browser.newPage());
    const cdp = await page.createCDPSession();
    const live = (await cdp.send("Browserless.liveURL" as any, {
      timeout: SESSION_TIMEOUT_MS,
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
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => undefined);
        await settle(page);
        break;
      }
      case "search": {
        await page
          .goto(searchUrl(action.query, action.engine), { waitUntil: "domcontentloaded", timeout: 30000 })
          .catch(() => undefined);
        await settle(page, 800);
        break;
      }
      case "back":
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => undefined);
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
        await sleep(Math.min(action.ms, 5000));
        break;
      case "screenshot":
        break;
    }

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