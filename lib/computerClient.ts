// lib/computerClient.ts
// Client-side glue for the cloud computer. startComputerSession spins up
// the VM and live view. runComputerTask is the actual agent loop: take a
// screenshot, ask the connected (vision-capable) AI what to do next,
// execute that action, repeat — until the AI says it's done or a safety
// step limit is hit.

import { auth } from "@/lib/firebase";
import { sendChatMessage } from "@/lib/chatClient";
import type { ComputerAction } from "@/lib/computerUse";

const MAX_STEPS = 25;

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

export async function startComputerSession(): Promise<{ sandboxId: string; streamUrl: string }> {
  const res = await fetch("/api/computer/start", { method: "POST", headers: await authedHeaders() });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to start the cloud computer.");
  return { sandboxId: data.sandboxId, streamUrl: data.streamUrl };
}

async function act(sandboxId: string, action: ComputerAction): Promise<string> {
  const res = await fetch("/api/computer/act", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ sandboxId, action }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Computer action failed.");
  return data.screenshotBase64 as string;
}

export async function stopComputerSession(sandboxId: string): Promise<void> {
  try {
    await fetch("/api/computer/stop", {
      method: "POST",
      headers: await authedHeaders(),
      body: JSON.stringify({ sandboxId }),
    });
  } catch {
    // Best-effort.
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Runs the actual "use the computer" loop for a task, driven by the
 * connected AI looking at each screenshot. */
export async function runComputerTask(
  providerId: string,
  apiKey: string,
  sandboxId: string,
  task: string,
  model?: string,
  onStep?: (stepDescription: string) => void
): Promise<string> {
  let screenshotB64 = await act(sandboxId, { type: "screenshot" });

  for (let step = 0; step < MAX_STEPS; step++) {
    const prompt = `You are operating a real remote Ubuntu desktop to accomplish this task: "${task}"

This is a screenshot of the current screen (attached as an image). Decide the SINGLE next action. Reply with ONLY raw JSON in one of these shapes:
{"action": "click", "x": number, "y": number, "button": "left", "double": false}
{"action": "type", "text": "..."}
{"action": "key", "key": "Return"}
{"action": "scroll", "amount": number}
{"action": "wait", "ms": number}
{"action": "done", "summary": "what was accomplished"}

Use "done" once the task is genuinely complete. Coordinates are pixel positions on the screenshot.`;

    const { text } = await sendChatMessage({
      providerId,
      apiKey,
      model,
      messages: [
        {
          role: "user",
          content: prompt,
          attachments: [{ name: "screen.png", mimeType: "image/png", dataUrl: `data:image/png;base64,${screenshotB64}` }],
        },
      ],
    });

    let decision: any;
    try {
      decision = JSON.parse(extractJson(text));
    } catch {
      onStep?.("Couldn't parse the next step — stopping.");
      break;
    }

    if (decision.action === "done") {
      onStep?.(`Done: ${decision.summary || "task complete"}`);
      return decision.summary || "Task completed.";
    }

    onStep?.(`Step ${step + 1}: ${decision.action} ${decision.x !== undefined ? `(${decision.x}, ${decision.y})` : decision.text || decision.key || ""}`);

    const action: ComputerAction =
      decision.action === "click"
        ? { type: "click", x: decision.x, y: decision.y, button: decision.button, double: decision.double }
        : decision.action === "type"
        ? { type: "type", text: decision.text }
        : decision.action === "key"
        ? { type: "key", key: decision.key }
        : decision.action === "scroll"
        ? { type: "scroll", amount: decision.amount }
        : { type: "wait", ms: decision.ms || 500 };

    screenshotB64 = await act(sandboxId, action);
  }

  return "Reached the step limit before the task was confirmed complete — check the live view to see where it got to.";
}