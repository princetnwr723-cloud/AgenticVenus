// lib/computerUse.ts
// The Cloud Computer (a real remote desktop) now gets its OWN Daytona
// sandbox PER CHAT (`scope`, normally the chatId) — unlike the coding
// workspace, a GUI desktop can't share one sandbox via folders, so "har chat
// me alag PC" means a genuinely separate sandbox per chat here.
//
// INTERNET ACCESS: Daytona sandboxes on paid tiers already have internet
// access by default (network is only blocked if you explicitly ask for it),
// so `networkBlockAll: false` is set explicitly as a safety net rather than
// something that "turns it on". IMPORTANT HONESTY NOTE, from Daytona's own
// docs: on Daytona's Tier 1 and Tier 2 (the lower usage/verification tiers),
// network access for sandboxes is restricted at the ACCOUNT level and Daytona
// rejects any attempt to override it per-sandbox — there is no code fix for
// that; the only way to get internet in sandboxes on those tiers is to
// verify/upgrade the Daytona organization's tier in their dashboard.
//
// GPU: Daytona GPU sandboxes are a distinct, on-demand resource with their
// own capacity/plan requirements. This makes a best-effort request and — if
// Daytona rejects it (wrong plan, no GPU capacity available, etc.) — surfaces
// Daytona's own error message honestly instead of pretending it worked.
import { Daytona } from "@daytona/sdk";
import { adminDb } from "@/lib/firebaseAdmin";
import { sanitizeScope } from "@/lib/workspaceScope";

const COLLECTION = "computerWorkspace";

export type ComputerAction =
  | { type: "screenshot" }
  | { type: "move"; x: number; y: number }
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "drag"; x1: number; y1: number; x2: number; y2: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "hotkey"; keys: string }
  | { type: "scroll"; amount: number; x?: number; y?: number; direction?: "up" | "down" }
  | { type: "launch"; command: string }
  | { type: "wait"; ms: number };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getStoredSandboxId(uid: string, scope: string): Promise<string | undefined> {
  const snap = await adminDb().collection("users").doc(uid).collection(COLLECTION).doc(scope).get();
  return snap.exists ? (snap.data()?.sandboxId as string | undefined) : undefined;
}

async function saveSandboxId(uid: string, scope: string, sandboxId: string) {
  await adminDb().collection("users").doc(uid).collection(COLLECTION).doc(scope).set({ sandboxId, updatedAt: Date.now() }, { merge: true });
}

export type StartComputerOptions = { uid?: string; scope?: string; gpu?: boolean };

export async function startComputer(apiKey: string, opts: StartComputerOptions = {}): Promise<{ sandboxId: string; gpuRequested: boolean }> {
  if (!apiKey) throw new Error("No Daytona API key — add yours in Settings → Integrations.");
  const { uid, gpu } = opts;
  const scope = sanitizeScope(opts.scope);
  const daytona = new Daytona({ apiKey });

  let sandbox: any = null;
  if (uid) {
    const existingId = await getStoredSandboxId(uid, scope);
    if (existingId) sandbox = await daytona.get(existingId).catch(() => null);
  }

  if (!sandbox) {
    const createOpts: any = { language: "typescript", autoDeleteInterval: -1, networkBlockAll: false };
    if (gpu) {
      // Best-effort GPU request — Daytona will reject this with its own
      // clear error if the plan/capacity doesn't support it, which we
      // surface as-is rather than guessing at a different shape.
      try {
        sandbox = await daytona.create({ ...createOpts, resources: { gpu: 1 } });
      } catch (err) {
        throw new Error(
          `GPU sandbox request failed — this usually means your Daytona plan doesn't include GPU capacity, or none is available right now. Daytona said: ${
            err instanceof Error ? err.message : String(err)
          }`
        );
      }
    } else {
      sandbox = await daytona.create(createOpts);
    }
  } else if (sandbox.state && sandbox.state !== "started") {
    await sandbox.start(60).catch(() => undefined);
  }

  await sandbox.computerUse.start();
  if (uid) await saveSandboxId(uid, scope, sandbox.id);
  return { sandboxId: sandbox.id, gpuRequested: !!gpu };
}

/** Signed preview URL — auth token is embedded in the URL itself, so no
 * header is needed by whoever loads it. */
export async function getSignedPreviewUrl(
  sandboxId: string,
  apiKey: string,
  port: number,
  expiresInSeconds = 43200
): Promise<{ url: string; token: string }> {
  const res = await fetch(
    `https://app.daytona.io/api/sandbox/${sandboxId}/ports/${port}/signed-preview-url?expiresInSeconds=${expiresInSeconds}`,
    { headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || "Failed to get a signed preview URL from Daytona.");
  return { url: data.url, token: data.token };
}

/** Daytona's ScreenshotResponse keeps the base64 image in `screenshot`. */
function extractBase64(shot: any): string {
  const raw = typeof shot === "string" ? shot : shot?.screenshot ?? shot?.image ?? shot?.data ?? shot?.base64 ?? "";
  if (typeof raw !== "string" || !raw) throw new Error("Daytona returned an empty screenshot.");
  return raw.replace(/^data:[^,]+,/, "");
}

const KEY_ALIASES: Record<string, string> = {
  enter: "Return", return: "Return", esc: "Escape", escape: "Escape", del: "Delete", delete: "Delete",
  backspace: "BackSpace", tab: "Tab", space: "space", up: "Up", down: "Down", left: "Left", right: "Right",
  arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right", pageup: "Page_Up", pagedown: "Page_Down",
  home: "Home", end: "End",
};

function normalizeKey(key: string): string {
  return KEY_ALIASES[key.trim().toLowerCase()] ?? key.trim();
}

export async function runComputerAction(
  sandboxId: string,
  apiKey: string,
  action: ComputerAction
): Promise<{ screenshotBase64: string }> {
  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.get(sandboxId);
  const cu: any = sandbox.computerUse;

  switch (action.type) {
    case "screenshot":
      break;
    case "move":
      await cu.mouse.move(action.x, action.y);
      break;
    case "click":
      await cu.mouse.click(action.x, action.y, action.button || "left", !!action.double);
      break;
    case "drag":
      await cu.mouse.drag(action.x1, action.y1, action.x2, action.y2, "left");
      break;
    case "type":
      await cu.keyboard.type(action.text);
      break;
    case "key":
      if (action.key.includes("+")) await cu.keyboard.hotkey(action.key.split("+").map(normalizeKey).join("+"));
      else await cu.keyboard.press(normalizeKey(action.key));
      break;
    case "hotkey":
      await cu.keyboard.hotkey(action.keys.split("+").map(normalizeKey).join("+"));
      break;
    case "scroll": {
      const x = action.x ?? 640;
      const y = action.y ?? 400;
      const direction = action.direction ?? (action.amount < 0 ? "up" : "down");
      await cu.mouse.scroll(x, y, direction, Math.max(1, Math.min(Math.abs(action.amount), 30)));
      break;
    }
    case "launch": {
      const cmd = action.command.replace(/'/g, "'\\''");
      await sandbox.process.executeCommand(`nohup sh -c '${cmd}' >/tmp/av-launch.log 2>&1 &`, undefined, { DISPLAY: ":0" }, 15);
      await sleep(2500);
      break;
    }
    case "wait":
      await sleep(Math.min(action.ms, 5000));
      break;
  }

  if (action.type !== "screenshot" && action.type !== "wait") await sleep(600);

  const shot = await cu.screenshot.takeFullScreen();
  return { screenshotBase64: extractBase64(shot) };
}

export async function stopComputer(sandboxId: string, apiKey: string, uid?: string, scope?: string): Promise<void> {
  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.get(sandboxId).catch(() => null);
  if (sandbox) {
    if (typeof sandbox.stop === "function") await sandbox.stop(60);
    else await sandbox.delete();
  }
  // Keep the sandbox id so a later Start computer resumes the SAME desktop —
  // same files, same browser logins, same everything, per chat.
  if (uid) await saveSandboxId(uid, sanitizeScope(scope), sandboxId).catch(() => undefined);
}