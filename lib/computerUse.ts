// lib/computerUse.ts
import { Daytona } from "@daytona/sdk";
import { adminDb } from "@/lib/firebaseAdmin";

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

export async function startComputer(apiKey: string, uid?: string): Promise<{ sandboxId: string }> {
  if (!apiKey) throw new Error("No Daytona API key — add yours in Settings → Integrations.");
  const daytona = new Daytona({ apiKey });
  const ref = uid ? adminDb().collection("users").doc(uid).collection("computerWorkspace").doc("default") : null;
  let sandbox: any = null;
  if (ref) {
    const snap = await ref.get();
    const existingId = snap.exists ? (snap.data()?.sandboxId as string | undefined) : undefined;
    if (existingId) sandbox = await daytona.get(existingId).catch(() => null);
  }
  if (!sandbox) sandbox = await daytona.create({ language: "typescript", autoDeleteInterval: -1 });
  if (sandbox.state && sandbox.state !== "started") await sandbox.start(60).catch(() => undefined);
  await sandbox.computerUse.start();
  if (ref) await ref.set({ sandboxId: sandbox.id, updatedAt: Date.now() }, { merge: true });
  return { sandboxId: sandbox.id };
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

/** Daytona's ScreenshotResponse keeps the base64 image in `screenshot`. The old
 * code only looked at `image`/`data`, so it could end up sending the literal
 * text "[object Object]" to the model as the "screenshot". */
function extractBase64(shot: any): string {
  const raw =
    typeof shot === "string"
      ? shot
      : shot?.screenshot ?? shot?.image ?? shot?.data ?? shot?.base64 ?? "";
  if (typeof raw !== "string" || !raw) throw new Error("Daytona returned an empty screenshot.");
  return raw.replace(/^data:[^,]+,/, "");
}

const KEY_ALIASES: Record<string, string> = {
  enter: "Return",
  return: "Return",
  esc: "Escape",
  escape: "Escape",
  del: "Delete",
  delete: "Delete",
  backspace: "BackSpace",
  tab: "Tab",
  space: "space",
  up: "Up",
  down: "Down",
  left: "Left",
  right: "Right",
  arrowup: "Up",
  arrowdown: "Down",
  arrowleft: "Left",
  arrowright: "Right",
  pageup: "Page_Up",
  pagedown: "Page_Down",
  home: "Home",
  end: "End",
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
      // Start a GUI app on the remote desktop (DISPLAY :0), detached so it keeps running.
      const cmd = action.command.replace(/'/g, "'\\''");
      await sandbox.process.executeCommand(`nohup sh -c '${cmd}' >/tmp/av-launch.log 2>&1 &`, undefined, { DISPLAY: ":0" }, 15);
      await sleep(2500);
      break;
    }
    case "wait":
      await sleep(Math.min(action.ms, 5000));
      break;
  }

  // Let the UI repaint before we look at it again.
  if (action.type !== "screenshot" && action.type !== "wait") await sleep(600);

  const shot = await cu.screenshot.takeFullScreen();
  return { screenshotBase64: extractBase64(shot) };
}

export async function stopComputer(sandboxId: string, apiKey: string, uid?: string): Promise<void> {
  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.get(sandboxId).catch(() => null);
  if (sandbox) {
    if (typeof sandbox.stop === "function") await sandbox.stop(60);
    else await sandbox.delete();
  }
  // Keep the sandbox id so a later Start computer resumes the same cloud PC/files.
  if (uid)
    await adminDb()
      .collection("users")
      .doc(uid)
      .collection("computerWorkspace")
      .doc("default")
      .set({ sandboxId, updatedAt: Date.now() }, { merge: true })
      .catch(() => undefined);
}