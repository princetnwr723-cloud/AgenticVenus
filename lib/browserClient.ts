// lib/browserClient.ts
import { auth } from "@/lib/firebase";
import { sendChatMessage } from "@/lib/chatClient";
import type { BrowserAction } from "@/lib/browserUse";

const MAX_STEPS = 60;

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

export async function startBrowserSession(): Promise<{ sessionId: string; liveUrl: string }> {
  const res = await fetch("/api/browser/start", { method: "POST", headers: await authedHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to start the browser.");
  return { sessionId: data.sessionId, liveUrl: data.liveUrl };
}

async function act(sessionId: string, action: BrowserAction) {
  const res = await fetch("/api/browser/act", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ sessionId, action }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Browser action failed.");
  return data as { screenshotBase64?: string; text?: string };
}

export async function stopBrowserSession(sessionId: string): Promise<void> {
  try {
    await fetch("/api/browser/stop", { method: "POST", headers: await authedHeaders(), body: JSON.stringify({ sessionId }) });
  } catch {}
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export async function runBrowserTask(
  providerId: string,
  apiKey: string,
  sessionId: string,
  task: string,
  model?: string,
  onStep?: (s: string) => void
): Promise<string> {
  let lastShot = (await act(sessionId, { type: "screenshot" })).screenshotBase64 || "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const prompt = `You are operating a real remote Chrome browser to accomplish this task: "${task}"

This is a screenshot of the current page (attached). Decide the SINGLE next action. Reply with ONLY raw JSON in one of these shapes:
{"action": "goto", "url": "https://..."}
{"action": "click", "x": number, "y": number, "button": "left", "double": false}
{"action": "type", "text": "..."}
{"action": "key", "key": "Enter"}
{"action": "scroll", "amount": number}
{"action": "extractText"}
{"action": "wait", "ms": number}
{"action": "done", "summary": "what was accomplished"}

Use "goto" first if no page is loaded yet. Use "extractText" to read the page instead of guessing from the screenshot. Use "done" once genuinely complete.`;

    const { text } = await sendChatMessage({
      providerId, apiKey, model,
      messages: [{
        role: "user", content: prompt,
        attachments: lastShot ? [{ name: "page.jpg", mimeType: "image/jpeg", dataUrl: `data:image/jpeg;base64,${lastShot}` }] : [],
      }],
    });

    let decision: any;
    try { decision = JSON.parse(extractJson(text)); }
    catch { onStep?.("Couldn't parse the next step — stopping."); break; }

    if (decision.action === "done") {
      onStep?.(`Done: ${decision.summary || "task complete"}`);
      return decision.summary || "Task completed.";
    }
    onStep?.(`Step ${step + 1}: ${decision.action} ${decision.url || decision.text || decision.key || ""}`);

    const action: BrowserAction =
      decision.action === "goto" ? { type: "goto", url: decision.url }
      : decision.action === "click" ? { type: "click", x: decision.x, y: decision.y, button: decision.button, double: decision.double }
      : decision.action === "type" ? { type: "type", text: decision.text }
      : decision.action === "key" ? { type: "key", key: decision.key }
      : decision.action === "scroll" ? { type: "scroll", amount: decision.amount }
      : decision.action === "extractText" ? { type: "extractText" }
      : { type: "wait", ms: decision.ms || 500 };

    const result = await act(sessionId, action);
    if (action.type === "extractText" && result.text) {
      onStep?.(`Read page text (${result.text.length} chars).`);
      lastShot = (await act(sessionId, { type: "screenshot" })).screenshotBase64 || lastShot;
    } else {
      lastShot = result.screenshotBase64 || lastShot;
    }
  }
  return "Reached the step limit before the task was confirmed complete.";
}