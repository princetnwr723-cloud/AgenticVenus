// lib/browserClient.ts
// Client-side driver for the remote browser. The model sees a screenshot of
// exactly the size we tell it, PLUS a numbered list of clickable elements, and
// mostly answers "click element 7" instead of guessing pixel coordinates.
import { auth } from "@/lib/firebase";
import { sendChatMessage } from "@/lib/chatClient";
import { parseFirstJson } from "@/lib/agentJson";
import type { BrowserAction, BrowserElement, SearchEngine } from "@/lib/browserUse";

const MAX_STEPS = 40;
const MAX_PARSE_FAILURES = 3;
const MAX_ACTION_ERRORS = 3;
const MAX_CAPTCHA_WAITS = 4;

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

export async function listBrowserProfiles(): Promise<{ name: string; cookieCount?: number; originCount?: number }[]> {
  const res = await fetch("/api/browser/profiles", { headers: await authedHeaders(), cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to list Browserless profiles.");
  return Array.isArray(data.profiles) ? data.profiles : [];
}

export async function startBrowserSession(profileName?: string): Promise<{ sessionId: string; liveUrl: string; profileName?: string }> {
  const res = await fetch("/api/browser/start", { method: "POST", headers: await authedHeaders(), body: JSON.stringify({ profileName: profileName || undefined }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to start the browser.");
  return { sessionId: data.sessionId, liveUrl: data.liveUrl, profileName: data.profileName };
}

type ActResult = {
  screenshotBase64?: string;
  text?: string;
  elements?: BrowserElement[];
  url?: string;
  title?: string;
  width?: number;
  height?: number;
  captchaLikely?: boolean;
};

async function act(sessionId: string, action: BrowserAction): Promise<ActResult> {
  const res = await fetch("/api/browser/act", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ sessionId, action }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Browser action failed.");
  return data as ActResult;
}

export async function stopBrowserSession(sessionId: string): Promise<void> {
  try {
    await fetch("/api/browser/stop", { method: "POST", headers: await authedHeaders(), body: JSON.stringify({ sessionId }) });
  } catch {}
}

function describeElements(elements: BrowserElement[]): string {
  if (!elements.length) return "(no clickable elements detected — use coordinates from the screenshot or scroll)";
  return elements
    .slice(0, 60)
    .map((e) => `[${e.index}] <${e.tag}${e.type ? ` ${e.type}` : ""}> "${e.label}" at (${e.x},${e.y})`)
    .join("\n");
}

type Decision = {
  action?: string;
  url?: string;
  query?: string;
  engine?: SearchEngine;
  index?: number;
  x?: number;
  y?: number;
  button?: "left" | "right" | "middle";
  double?: boolean;
  text?: string;
  submit?: boolean;
  clear?: boolean;
  key?: string;
  amount?: number;
  ms?: number;
  summary?: string;
  reason?: string;
};

export async function runBrowserTask(
  providerId: string,
  apiKey: string,
  sessionId: string,
  task: string,
  model?: string,
  onStep?: (s: string) => void
): Promise<string> {
  let state: ActResult = await act(sessionId, { type: "screenshot" });
  const history: string[] = [];
  const collected: string[] = [];
  let lastExtract = "";
  let parseFailures = 0;
  let actionErrors = 0;
  let captchaWaits = 0;
  let lastSignature = "";
  let repeats = 0;
  let hint = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const width = state.width || 1280;
    const height = state.height || 800;
    const elements = state.elements || [];

    const captchaNote = state.captchaLikely
      ? `\nHEADS UP: this looks like a bot-check / CAPTCHA page. Browserless auto-solves most of these in the background within 15-30 seconds — do NOT give up or change strategy immediately. Use {"action":"wait","ms":8000} once or twice and check again before deciding it's really stuck. If it's genuinely still blocking after a few waits, try {"action":"search","engine":"bing"} or "duckduckgo" instead of Google, which gets flagged far less.\n`
      : "";

    const prompt = `You are operating a real remote Chrome browser to accomplish this task:
"${task}"

CURRENT PAGE
url: ${state.url || "(blank)"}
title: ${state.title || "(none)"}
The attached screenshot is exactly ${width}x${height} pixels and shows the visible viewport. Pixel coordinates you give map 1:1 onto it.
${captchaNote}
CLICKABLE ELEMENTS VISIBLE RIGHT NOW (centre coordinates are exact):
${describeElements(elements)}

WHAT YOU HAVE DONE SO FAR
${history.length ? history.slice(-10).join("\n") : "(nothing yet)"}
${lastExtract ? `\nTEXT YOU EXTRACTED IN THE PREVIOUS STEP (use it, then continue or finish):\n${lastExtract.slice(0, 5000)}\n` : ""}${hint ? `\nNOTE: ${hint}\n` : ""}
Decide the SINGLE next action. Reply with ONLY raw JSON in one of these shapes:
{"action":"search","query":"...","engine":"duckduckgo"}   (opens a web search directly — engine may be duckduckgo, bing or google; prefer duckduckgo/bing, Google flags automated traffic fastest)
{"action":"goto","url":"https://..."}
{"action":"click_element","index":7}                       (PREFERRED way to click — index from the list above)
{"action":"click","x":number,"y":number}                   (only if the target is not in the list)
{"action":"type","text":"...","submit":true,"clear":false} (types into the focused field; click_element the field first)
{"action":"key","key":"Enter"}                             (also combos like "Control+a")
{"action":"scroll","amount":600}                           (positive = down)
{"action":"back"}
{"action":"extractText"}                                   (reads the page text — use this to collect data)
{"action":"wait","ms":8000}                                (use this while a captcha is auto-solving)
{"action":"done","summary":"the actual findings/result, with concrete details"}
{"action":"fail","reason":"why this can't be completed"}

RULES
- To look something up, use "search" instead of clicking a search box.
- Prefer click_element over raw coordinates. Focus an input with click_element, then "type".
- To gather information, use "extractText" and put the real facts in "done.summary" — not "I found it".
- Dismiss cookie/consent pop-ups if they block the page.
- Never repeat the same action expecting a different result; change approach.
- Stay on task. Use "done" as soon as the task is genuinely complete.`;

    let text = "";
    try {
      ({ text } = await sendChatMessage({
        providerId,
        apiKey,
        model,
        messages: [
          {
            role: "user",
            content: prompt,
            attachments: state.screenshotBase64
              ? [{ name: "page.jpg", mimeType: "image/jpeg", dataUrl: `data:image/jpeg;base64,${state.screenshotBase64}` }]
              : [],
          },
        ],
      }));
    } catch (err) {
      throw new Error(`The AI provider failed while driving the browser: ${err instanceof Error ? err.message : String(err)}`);
    }

    const decision = parseFirstJson<Decision>(text);
    if (!decision || !decision.action) {
      parseFailures++;
      if (parseFailures >= MAX_PARSE_FAILURES) {
        onStep?.("The model kept answering in an unreadable format — stopping.");
        break;
      }
      hint = "Your last reply was not valid JSON. Reply with ONLY one JSON object.";
      onStep?.("Couldn't read the next step, retrying…");
      continue;
    }
    parseFailures = 0;
    hint = "";

    if (decision.action === "done") {
      onStep?.(`Done: ${decision.summary || "task complete"}`);
      return decision.summary || (collected.length ? collected.join("\n---\n").slice(0, 4000) : "Task completed.");
    }
    if (decision.action === "fail") {
      onStep?.(`Couldn't complete: ${decision.reason || "unknown reason"}`);
      return `Could not complete the task: ${decision.reason || "unknown reason"}.`;
    }
    if (decision.action === "wait" && state.captchaLikely) {
      captchaWaits++;
      if (captchaWaits > MAX_CAPTCHA_WAITS) hint = "Waiting hasn't cleared the captcha after several tries — switch to a different search engine or site instead of waiting again.";
    }

    // ---- translate the decision into a concrete browser action ----
    let action: BrowserAction | null = null;
    let label = decision.action;

    switch (decision.action) {
      case "search":
        if (decision.query) {
          action = { type: "search", query: decision.query, engine: decision.engine };
          label = `search "${decision.query}"`;
        }
        break;
      case "goto":
        if (decision.url) {
          action = { type: "goto", url: decision.url };
          label = `goto ${decision.url}`;
        }
        break;
      case "click_element": {
        const el = elements.find((e) => e.index === Number(decision.index));
        if (el) {
          action = { type: "click", x: el.x, y: el.y };
          label = `click [${el.index}] "${el.label}"`;
        } else {
          hint = `Element ${decision.index} does not exist in the current list. Pick an index that is listed.`;
        }
        break;
      }
      case "click":
        if (typeof decision.x === "number" && typeof decision.y === "number") {
          action = { type: "click", x: Math.round(decision.x), y: Math.round(decision.y), button: decision.button, double: decision.double };
          label = `click (${Math.round(decision.x)}, ${Math.round(decision.y)})`;
        }
        break;
      case "type":
        if (typeof decision.text === "string") {
          action = { type: "type", text: decision.text, submit: !!decision.submit, clear: !!decision.clear };
          label = `type "${decision.text.slice(0, 40)}"${decision.submit ? " + Enter" : ""}`;
        }
        break;
      case "key":
        if (decision.key) {
          action = { type: "key", key: decision.key };
          label = `key ${decision.key}`;
        }
        break;
      case "scroll":
        action = { type: "scroll", amount: Number(decision.amount) || 600 };
        label = `scroll ${Number(decision.amount) || 600}`;
        break;
      case "back":
        action = { type: "back" };
        break;
      case "extractText":
        action = { type: "extractText" };
        break;
      case "wait":
        action = { type: "wait", ms: Number(decision.ms) || 800 };
        label = `wait ${Number(decision.ms) || 800}ms`;
        break;
    }

    if (!action) {
      history.push(`${history.length + 1}. (invalid "${decision.action}" action — ignored)`);
      hint = hint || `The "${decision.action}" action was missing required fields. Use one of the documented shapes.`;
      actionErrors++;
      if (actionErrors >= MAX_ACTION_ERRORS + 2) break;
      continue;
    }

    // ---- loop detection (waits during an active captcha don't count as stuck) ----
    if (action.type !== "wait" || !state.captchaLikely) {
      const signature = `${label}@${state.url}`;
      repeats = signature === lastSignature ? repeats + 1 : 0;
      lastSignature = signature;
      if (repeats >= 4) {
        onStep?.("Stuck repeating the same action — stopping.");
        return `Stopped because the browser got stuck repeating "${label}" on ${state.url}. Partial notes: ${collected.join("\n").slice(0, 1500) || "none"}`;
      }
      if (repeats >= 2) hint = `You have repeated "${label}" ${repeats + 1} times with no progress. Try a different element, scroll, or another site.`;
    }

    onStep?.(`Step ${step + 1}: ${label}`);

    try {
      const result = await act(sessionId, action);
      actionErrors = 0;
      state = { ...state, ...result, text: undefined };
      if (action.type === "extractText" && result.text) {
        lastExtract = result.text;
        collected.push(`[${result.url || state.url}] ${result.text.slice(0, 2500)}`);
        onStep?.(`Read page text (${result.text.length} chars).`);
        history.push(`${history.length + 1}. extractText on ${result.title || result.url}`);
      } else {
        lastExtract = "";
        history.push(`${history.length + 1}. ${label} → now on "${result.title || result.url || "?"}"${result.captchaLikely ? " (captcha page)" : ""}`);
      }
    } catch (err) {
      actionErrors++;
      const message = err instanceof Error ? err.message : String(err);
      history.push(`${history.length + 1}. ${label} → FAILED: ${message.slice(0, 120)}`);
      hint = `The last action failed: ${message.slice(0, 200)}. Try a different approach.`;
      if (actionErrors >= MAX_ACTION_ERRORS) throw new Error(`Browser actions keep failing: ${message}`);
      try {
        state = { ...state, ...(await act(sessionId, { type: "screenshot" })) };
      } catch {}
    }
  }

  const notes = collected.length ? ` Partial notes:\n${collected.join("\n---\n").slice(0, 3000)}` : "";
  return `Reached the step limit before the task was confirmed complete.${notes}`;
}