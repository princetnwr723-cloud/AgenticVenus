// lib/browserUse.ts
// Real browser automation via Browserless — connects a remote Chrome over
// CDP with the user's own token, gives the agent goto/click/type/scroll
// actions, plus a live watchable URL.
//
// SESSION ACROSS SERVERLESS REQUESTS: right after opening the browser,
// `Browserless.reconnect` hands back a session-specific browserWSEndpoint
// that survives a disconnect for a given timeout — Browserless caps this
// at 120000ms (2 min) max, so a truly idle session does expire quickly.
// To keep an ACTIVELY-used session alive, every action call re-issues
// Browserless.reconnect and refreshes the stored endpoint before
// disconnecting, effectively renewing the timeout on each step.

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { adminDb } from "@/lib/firebaseAdmin";

const REGION = "production-sfo.browserless.io";
const SESSION_TIMEOUT_MS = 110_000; // Browserless's hard cap is 120000ms

export type BrowserAction =
  | { type: "screenshot" }
  | { type: "goto"; url: string }
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "extractText" }
  | { type: "wait"; ms: number };

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

/** Calls Browserless.reconnect on an already-connected browser and
 * returns a fresh, token-bearing endpoint good for another
 * SESSION_TIMEOUT_MS after this connection drops. */
async function refreshReconnectEndpoint(browser: Browser, apiKey: string): Promise<string> {
  const page = (await browser.pages())[0] || (await browser.newPage());
  const cdp = await page.createCDPSession();
  const { error, browserWSEndpoint } = (await cdp.send("Browserless.reconnect" as any, {
    timeout: SESSION_TIMEOUT_MS,
  } as any)) as { error?: string; browserWSEndpoint?: string };
  if (error || !browserWSEndpoint) throw new Error(error || "Browserless didn't return a reconnect endpoint.");
  return `${browserWSEndpoint}?token=${apiKey}`;
}

export async function startBrowserSession(uid: string, apiKey: string): Promise<{ sessionId: string; liveUrl: string }> {
  const browser = await puppeteer.connect({ browserWSEndpoint: `wss://${REGION}/?token=${apiKey}` });

  const reconnectEndpoint = await refreshReconnectEndpoint(browser, apiKey);
  const browserId = reconnectEndpoint.split("?")[0].split("/").pop()!;

  const sessionId = crypto.randomUUID();
  await saveSession(uid, sessionId, reconnectEndpoint);

  let liveUrl = "";
  try {
    const liveRes = await fetch(`https://${REGION}/browser/${browserId}/live?token=${apiKey}`, { method: "POST" });
    const liveData = await liveRes.json().catch(() => null);
    liveUrl = liveData?.liveURL || liveData?.url || liveData?.liveUrl || "";
  } catch {
    // Live view is a nice-to-have — the agent can still work without it.
  }

  await browser.disconnect();
  return { sessionId, liveUrl };
}

export async function runBrowserAction(
  uid: string,
  sessionId: string,
  action: BrowserAction,
  apiKey: string
): Promise<{ screenshotBase64?: string; text?: string }> {
  const reconnectEndpoint = await loadReconnectEndpoint(uid, sessionId);
  const browser: Browser = await puppeteer.connect({ browserWSEndpoint: reconnectEndpoint });
  try {
    const pages = await browser.pages();
    const page: Page = pages[pages.length - 1] || (await browser.newPage());

    switch (action.type) {
      case "goto":
        await page.goto(action.url, { waitUntil: "domcontentloaded", timeout: 30000 });
        break;
      case "click":
        await page.mouse.click(action.x, action.y, { button: action.button || "left", clickCount: action.double ? 2 : 1 });
        break;
      case "type":
        await page.keyboard.type(action.text, { delay: 15 });
        break;
      case "key":
        await page.keyboard.press(action.key as any);
        break;
      case "scroll":
        await page.evaluate((amt) => window.scrollBy(0, amt), action.amount);
        break;
      case "extractText": {
        const text = await page.evaluate(() => document.body.innerText || "");
        // Renew the session's timeout since it's actively being used.
        const fresh = await refreshReconnectEndpoint(browser, apiKey);
        await saveSession(uid, sessionId, fresh);
        return { text: text.slice(0, 4000) };
      }
      case "wait":
        await new Promise((r) => setTimeout(r, Math.min(action.ms, 5000)));
        break;
      case "screenshot":
        break;
    }

    const shot = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 55 });
    // Renew the session's timeout on every real action.
    const fresh = await refreshReconnectEndpoint(browser, apiKey);
    await saveSession(uid, sessionId, fresh);
    return { screenshotBase64: shot as string };
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