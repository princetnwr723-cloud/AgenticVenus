"use client";

// lib/siteInspector.ts
// Look at a real reference site before building something "like" it, so the
// Developer Agent designs from what's actually there instead of guessing —
// this is what was missing when it built a "clone" of a site without ever
// opening it.

import { auth } from "@/lib/firebase";
import type { BrowserAction } from "@/lib/browserUse";

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

async function act(sessionId: string, action: BrowserAction) {
  const res = await fetch("/api/browser/act", { method: "POST", headers: await authedHeaders(), body: JSON.stringify({ sessionId, action }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Browser action failed.");
  return data as { text?: string; url?: string; title?: string };
}

const REFERENCE_RE = /(?:like|clone|copy|recreate|inspired by|similar to)\s+(?:the\s+)?(?:site|website|design of\s+)?(https?:\/\/\S+|[\w-]+\.[a-z]{2,}(?:\/\S*)?)/i;
const BARE_URL_RE = /https?:\/\/[^\s)]+/i;

export function findReferenceUrl(task: string): string | null {
  const m = task.match(REFERENCE_RE) || task.match(BARE_URL_RE);
  if (!m) return null;
  const raw = m[1] || m[0];
  return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
}

/** One-shot: open the page, read its visible text. Returns null (never
 * throws) so a failed inspection — e.g. no Browserless key connected — just
 * means the build proceeds without it, rather than blocking the task. */
export async function inspectReferenceSite(url: string): Promise<string | null> {
  try {
    const startRes = await fetch("/api/browser/start", { method: "POST", headers: await authedHeaders(), body: JSON.stringify({}) });
    const start = await startRes.json();
    if (!startRes.ok) return null;
    const sessionId = start.sessionId as string;
    try {
      const page = await act(sessionId, { type: "goto", url });
      const extracted = await act(sessionId, { type: "extractText" });
      const text = (extracted.text || "").slice(0, 4000);
      if (!text.trim()) return null;
      return `URL actually opened: ${page.url || url}\nTitle: ${page.title || "(none)"}\n\nVisible text from the real page (match its actual sections, headings and wording — don't invent content that isn't here):\n${text}`;
    } finally {
      await fetch("/api/browser/stop", { method: "POST", headers: await authedHeaders(), body: JSON.stringify({ sessionId }) }).catch(() => undefined);
    }
  } catch {
    return null;
  }
}