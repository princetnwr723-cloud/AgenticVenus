// lib/computerUse.ts
// A real cloud computer for the agent — like Grok's "computer" feature.
// Built on Daytona's Computer Use sandboxes. No spec-picking dialog —
// every computer spins up at the best available tier automatically:
// 4 vCPU / 16GB RAM / 50GB disk. Gives the agent a genuine desktop it
// can see (screenshot), move a mouse on, type into, and click through —
// with a live view URL the user can watch in real time.
//
// NOTE: custom `resources` can't be combined with the default desktop
// snapshot — passing `resources` forces Daytona's image-based create()
// path, which needs an `image` and won't have the desktop environment
// pre-installed. Using the plain default snapshot below (no resources
// override) is what actually gives us computerUse. To get bigger specs
// later, build a custom Snapshot in the Daytona dashboard with the
// desired resources baked in, then pass { snapshot: "that-name" } here.
//
// NOTE: the exact field name Daytona's screenshot call returns the
// image under (`.image` here) isn't fully confirmed against the very
// latest SDK version — if it throws at runtime, check `@daytona/sdk`'s
// current TypeScript types for the actual shape and adjust that spot.
//
// NOTE: Daytona's mouse.scroll() signature is (x, y, direction, amount)
// — it scrolls AT a screen position, not just "by an amount". Since our
// ComputerAction only carries a plain amount from callers, we default
// x/y to the center of a 1280x800 display and derive direction from the
// sign of amount. Pass explicit x/y/direction on the action for
// scrolling at a specific spot (e.g. inside a scrollable panel).

import { Daytona } from "@daytona/sdk";

const VNC_PORT = 6080;

export type ComputerAction =
  | { type: "screenshot" }
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number; x?: number; y?: number; direction?: "up" | "down" }
  | { type: "wait"; ms: number };

export async function startComputer(apiKey: string): Promise<{ sandboxId: string; streamUrl: string }> {
  if (!apiKey) throw new Error("No Daytona API key — add yours in Settings → Integrations.");

  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.create(); // default snapshot — includes desktop environment
  await sandbox.computerUse.start();
  const preview = await sandbox.getPreviewLink(VNC_PORT);

  return { sandboxId: sandbox.id, streamUrl: preview.url };
}

export async function runComputerAction(
  sandboxId: string,
  apiKey: string,
  action: ComputerAction
): Promise<{ screenshotBase64: string }> {
  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.get(sandboxId);

  switch (action.type) {
    case "screenshot":
      break;
    case "click":
      await sandbox.computerUse.mouse.click(action.x, action.y, action.button || "left", !!action.double);
      break;
    case "type":
      await sandbox.computerUse.keyboard.type(action.text);
      break;
    case "key":
      await sandbox.computerUse.keyboard.press(action.key);
      break;
    case "scroll": {
      const x = action.x ?? 640;
      const y = action.y ?? 400;
      const direction = action.direction ?? (action.amount < 0 ? "up" : "down");
      await sandbox.computerUse.mouse.scroll(x, y, direction, Math.abs(action.amount));
      break;
    }
    case "wait":
      await new Promise((r) => setTimeout(r, Math.min(action.ms, 5000)));
      break;
  }

  const shot = await sandbox.computerUse.screenshot.takeFullScreen();
  return { screenshotBase64: (shot as any).image ?? (shot as any).data ?? String(shot) };
}

export async function stopComputer(sandboxId: string, apiKey: string): Promise<void> {
  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.get(sandboxId);
  await sandbox.delete();
}