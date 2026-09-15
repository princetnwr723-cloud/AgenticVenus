// lib/computerUse.ts
// A real cloud computer for the agent — like Grok's "computer" feature.
// Built on Daytona's Computer Use sandboxes. No spec-picking dialog —
// every computer spins up at the best available tier automatically:
// 4 vCPU / 16GB RAM / 50GB disk. Gives the agent a genuine desktop it
// can see (screenshot), move a mouse on, type into, and click through —
// with a live view URL the user can watch in real time.
//
// NOTE: the exact field name Daytona's screenshot call returns the
// image under (`.image` here) and the scroll method aren't fully
// confirmed against the very latest SDK version — if either throws at
// runtime, check `@daytona/sdk`'s current TypeScript types for the
// actual shape and adjust these two spots.

import { Daytona } from "@daytona/sdk";

const VNC_PORT = 6080;
const TOP_SPECS = { cpu: 4, memory: 16, disk: 50 };

export type ComputerAction =
  | { type: "screenshot" }
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number }
  | { type: "wait"; ms: number };

export async function startComputer(apiKey: string): Promise<{ sandboxId: string; streamUrl: string }> {
  if (!apiKey) throw new Error("No Daytona API key — add yours in Settings → Integrations.");

  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.create({ resources: TOP_SPECS });
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
    case "scroll":
      await sandbox.computerUse.mouse.scroll(action.amount);
      break;
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