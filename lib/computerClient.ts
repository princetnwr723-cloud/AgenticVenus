// lib/computerClient.ts
// Client-side glue for the cloud computer. runComputerTask is the agent loop:
// take a screenshot, downscale it to a size we control, ask the connected
// vision model for the next action, convert its coordinates back to real
// screen pixels, execute, repeat — until "done"/"fail" or the step limit.
import { auth } from "@/lib/firebase";
import { sendChatMessage } from "@/lib/chatClient";
import { parseFirstJson } from "@/lib/agentJson";
import { scaleImage, type ScaledImage } from "@/lib/imageScale";
import type { ComputerAction } from "@/lib/computerUse";

const MAX_STEPS = 50;
const MAX_PARSE_FAILURES = 3;
const MAX_ACTION_ERRORS = 3;
const MODEL_IMAGE_EDGE = 1280;

const GPU_HINT = /\bgpu\b|\bcuda\b|stable diffusion|train(ing)? (a )?model|fine-?tune|llama\.cpp|pytorch|tensorflow|render(ing)? (video|3d)|blender render|whisper (large|transcribe)/i;

/** Decide once, from the request text, whether this needs a GPU box — a tiny
 * task ("open a browser and check X") gets the normal, fast desktop; a
 * GPU-shaped one ("train a small model", "run stable diffusion") asks for a
 * GPU sandbox and, if Daytona says the plan/capacity doesn't allow it, that
 * real reason is what gets reported back instead of silently downgrading. */
export function decideComputerStart(task: string): { gpu: boolean; reason: string } {
  if (GPU_HINT.test(task)) return { gpu: true, reason: "This looks like it needs GPU compute (training/inference/rendering)." };
  return { gpu: false, reason: "A normal desktop is enough for this." };
}

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

export async function startComputerSession(scope?: string, gpu = false): Promise<{ sandboxId: string; gpuRequested: boolean }> {
  const res = await fetch("/api/computer/start", { method: "POST", headers: await authedHeaders(), body: JSON.stringify({ scope, gpu }) });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to start the cloud computer.");
  return { sandboxId: data.sandboxId, gpuRequested: !!data.gpuRequested };
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

export async function getComputerLiveUrl(sandboxId: string): Promise<string> {
  const res = await fetch(`/api/computer/live-url?sandboxId=${encodeURIComponent(sandboxId)}`, { headers: await authedHeaders(), cache: "no-store" });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to create the computer live view.");
  return data.url as string;
}

export async function stopComputerSession(sandboxId: string, scope?: string): Promise<void> {
  try {
    await fetch("/api/computer/stop", {
      method: "POST",
      headers: await authedHeaders(),
      body: JSON.stringify({ sandboxId, scope }),
    });
  } catch {
    // Best-effort.
  }
}

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Screenshots come back as PNG from Daytona; detect the real mime type. */
function mimeOf(base64: string): string {
  const head = base64.slice(0, 12);
  if (head.startsWith("/9j/")) return "image/jpeg";
  if (head.startsWith("UklGR")) return "image/webp";
  return "image/png";
}

async function look(sandboxId: string, action: ComputerAction): Promise<ScaledImage> {
  const raw = await act(sandboxId, action);
  return scaleImage(raw, mimeOf(raw), MODEL_IMAGE_EDGE);
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
  let shot = await look(sandboxId, { type: "screenshot" });
  const history: string[] = [];
  let parseFailures = 0;
  let actionErrors = 0;
  let lastSignature = "";
  let repeats = 0;
  let hint = "";

  for (let step = 0; step < MAX_STEPS; step++) {
    const prompt = `You are operating a real remote Linux desktop (mouse + keyboard) to accomplish this task:
"${task}"

The attached screenshot is exactly ${shot.width}x${shot.height} pixels. Every x/y you give is a pixel position on THAT image, (0,0) at the top-left.

WHAT YOU HAVE DONE SO FAR
${history.length ? history.slice(-10).join("\n") : "(nothing yet)"}
${hint ? `\nNOTE: ${hint}\n` : ""}
Decide the SINGLE next action. Reply with ONLY raw JSON in one of these shapes:
{"action":"click","x":number,"y":number}
{"action":"double_click","x":number,"y":number}
{"action":"right_click","x":number,"y":number}
{"action":"drag","x1":number,"y1":number,"x2":number,"y2":number}
{"action":"type","text":"..."}                        (types into the focused control)
{"action":"key","key":"Enter"}                        (Enter, Tab, Escape, Backspace, Up, Down, ...)
{"action":"hotkey","keys":"ctrl+l"}                   (key combos: ctrl+l, ctrl+t, ctrl+a, alt+Tab, ...)
{"action":"scroll","x":number,"y":number,"direction":"down","amount":5}   (amount = wheel clicks, 1-10)
{"action":"launch","command":"firefox https://example.com"}              (starts a GUI app)
{"action":"wait","ms":1500}
{"action":"done","summary":"what was accomplished, with concrete details"}
{"action":"fail","reason":"why it can't be done"}

RULES
- Click the CENTRE of the control you want. Click a text field first, then "type".
- If the screen is an empty desktop, "launch" the app you need (try firefox, chromium, google-chrome --no-sandbox, xfce4-terminal, mousepad). If a launch didn't produce a window, try another command.
- In a browser, use hotkey ctrl+l, type the address, then key Enter — faster than clicking.
- After an action, check the NEXT screenshot to confirm it worked before moving on.
- Never repeat the same action expecting a different result; change approach.
- Use "done" only when the task is genuinely complete, and put the real result in the summary.`;

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
            attachments: [{ name: "screen.jpg", mimeType: shot.mimeType, dataUrl: `data:${shot.mimeType};base64,${shot.base64}` }],
          },
        ],
      }));
    } catch (err) {
      throw new Error(`The AI provider failed while driving the computer: ${err instanceof Error ? err.message : String(err)}`);
    }

    const d = parseFirstJson<any>(text) as any;
    if (!d || !d.action) {
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

    if (d.action === "done") {
      onStep?.(`Done: ${d.summary || "task complete"}`);
      return d.summary || "Task completed.";
    }
    if (d.action === "fail") {
      onStep?.(`Couldn't complete: ${d.reason || "unknown reason"}`);
      return `Could not complete the task: ${d.reason || "unknown reason"}.`;
    }

    const px = (n: number | undefined) => Math.round((Number(n) || 0) * shot.factor);
    let action: ComputerAction | null = null;
    let label: string = d.action;

    switch (d.action) {
      case "click":
        if (d.x !== undefined && d.y !== undefined) {
          action = { type: "click", x: px(d.x), y: px(d.y), button: d.button || "left" };
          label = `click (${Math.round(d.x)}, ${Math.round(d.y)})`;
        }
        break;
      case "double_click":
        if (d.x !== undefined && d.y !== undefined) {
          action = { type: "click", x: px(d.x), y: px(d.y), double: true };
          label = `double-click (${Math.round(d.x)}, ${Math.round(d.y)})`;
        }
        break;
      case "right_click":
        if (d.x !== undefined && d.y !== undefined) {
          action = { type: "click", x: px(d.x), y: px(d.y), button: "right" };
          label = `right-click (${Math.round(d.x)}, ${Math.round(d.y)})`;
        }
        break;
      case "drag":
        if ([d.x1, d.y1, d.x2, d.y2].every((n: any) => typeof n === "number")) {
          action = { type: "drag", x1: px(d.x1), y1: px(d.y1), x2: px(d.x2), y2: px(d.y2) };
          label = `drag (${d.x1},${d.y1}) → (${d.x2},${d.y2})`;
        }
        break;
      case "type":
        if (typeof d.text === "string") {
          action = { type: "type", text: d.text };
          label = `type "${d.text.slice(0, 40)}"`;
        }
        break;
      case "key":
        if (d.key) {
          action = { type: "key", key: d.key };
          label = `key ${d.key}`;
        }
        break;
      case "hotkey":
        if (d.keys) {
          action = { type: "hotkey", keys: d.keys };
          label = `hotkey ${d.keys}`;
        }
        break;
      case "scroll": {
        const direction = d.direction === "up" || (d.amount ?? 0) < 0 ? "up" : "down";
        action = { type: "scroll", amount: Math.max(1, Math.min(Math.abs(Number(d.amount) || 5), 10)), x: d.x !== undefined ? px(d.x) : undefined, y: d.y !== undefined ? px(d.y) : undefined, direction };
        label = `scroll ${direction}`;
        break;
      }
      case "launch":
        if (d.command) {
          action = { type: "launch", command: d.command };
          label = `launch ${d.command}`;
        }
        break;
      case "wait":
        action = { type: "wait", ms: Number(d.ms) || 1000 };
        break;
    }

    if (!action) {
      history.push(`${history.length + 1}. (invalid "${d.action}" action — ignored)`);
      hint = `The "${d.action}" action was missing required fields. Use one of the documented shapes.`;
      actionErrors++;
      if (actionErrors >= MAX_ACTION_ERRORS + 2) break;
      continue;
    }

    const signature = label;
    repeats = signature === lastSignature ? repeats + 1 : 0;
    lastSignature = signature;
    if (repeats >= 4) {
      onStep?.("Stuck repeating the same action — stopping.");
      return `Stopped because the desktop got stuck repeating "${label}". Check the live view to see where it got to.`;
    }
    if (repeats >= 2) hint = `You have repeated "${label}" ${repeats + 1} times with no visible change. Try something different.`;

    onStep?.(`Step ${step + 1}: ${label}`);

    try {
      shot = await look(sandboxId, action);
      actionErrors = 0;
      history.push(`${history.length + 1}. ${label}`);
    } catch (err) {
      actionErrors++;
      const message = err instanceof Error ? err.message : String(err);
      history.push(`${history.length + 1}. ${label} → FAILED: ${message.slice(0, 120)}`);
      hint = `The last action failed: ${message.slice(0, 200)}. Try a different approach.`;
      if (actionErrors >= MAX_ACTION_ERRORS) throw new Error(`Computer actions keep failing: ${message}`);
      try {
        shot = await look(sandboxId, { type: "screenshot" });
      } catch {}
    }
  }

  return "Reached the step limit before the task was confirmed complete — check the live view to see where it got to.";
}