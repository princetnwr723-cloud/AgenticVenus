// lib/browserUse.ts
// Real browser automation via Browserless — connects a remote Chrome over
// CDP with the user's own token, gives the agent goto/click/type/scroll
// actions (same loop shape as Computer Use), plus a live watchable URL.
//
// SESSION ACROSS SERVERLESS REQUESTS: a Vercel function can't hold a live
// connection open between requests. Fix: right after opening the browser,
// call Browserless's own `Browserless.reconnect` CDP command — it hands
// back a session-specific browserWSEndpoint that survives a disconnect
// for a given timeout. We store THAT server-side (it has the token in
// it) in Firestore keyed by a random session id, and only ever give the
// browser that random id.

import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { adminDb } from "@/lib/firebaseAdmin";

const REGION = "production-sfo.browserless.io";
const SESSION_TIMEOUT_MS = 15 * 60 * 1000; // 15 min idle timeout

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

export async function startBrowserSession(uid: string, apiKey: string): Promise<{ sessionId: string; liveUrl: string }> {
  const browser = await puppeteer.connect({ browserWSEndpoint: `wss://${REGION}/?token=${apiKey}` });
  const page = await browser.newPage();
  const cdp = await page.createCDPSession();

  const { error, browserWSEndpoint } = (await cdp.send("Browserless.reconnect" as any, {
    timeout: SESSION_TIMEOUT_MS,
  } as any)) as { error?: string; browserWSEndpoint?: string };
  if (error || !browserWSEndpoint) throw new Error(error || "Browserless didn't return a reconnect endpoint.");

  const reconnectEndpoint = `${browserWSEndpoint}?token=${apiKey}`;
  const browserId = browserWSEndpoint.split("/").pop()!;

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

  await browser.disconnect(); // frees this request's connection; remote browser stays up (reconnect timeout above)
  return { sessionId, liveUrl };
}

export async function runBrowserAction(
  uid: string,
  sessionId: string,
  action: BrowserAction
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
        return { text: text.slice(0, 4000) };
      }
      case "wait":
        await new Promise((r) => setTimeout(r, Math.min(action.ms, 5000)));
        break;
      case "screenshot":
        break;
    }

    const shot = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 55 });
    return { screenshotBase64: shot as string };
  } finally {
    await browser.disconnect();
  }
}

export async function stopBrowserSession(uid: string, sessionId: string): Promise<void> {
  try {
    const reconnectEndpoint = await loadReconnectEndpoint(uid, sessionId);
    const browser = await puppeteer.connect({ browserWSEndpoint: reconnectEndpoint });
    await browser.close(); // real close — frees the Browserless slot
  } catch {
    // best-effort
  } finally {
    await adminDb().collection("users").doc(uid).collection("browserSessions").doc(sessionId).delete().catch(() => null);
  }
}