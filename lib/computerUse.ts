// lib/computerUse.ts
import { Daytona } from "@daytona/sdk";
import { adminDb } from "@/lib/firebaseAdmin";

const VNC_PORT = 6080;

export type ComputerAction =
  | { type: "screenshot" }
  | { type: "click"; x: number; y: number; button?: "left" | "right" | "middle"; double?: boolean }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; amount: number; x?: number; y?: number; direction?: "up" | "down" }
  | { type: "wait"; ms: number };

export async function startComputer(apiKey: string, uid?: string): Promise<{ sandboxId: string }> {
  if (!apiKey) throw new Error("No Daytona API key — add yours in Settings → Integrations.");
  const daytona = new Daytona({ apiKey });
  const ref = uid ? adminDb().collection("users").doc(uid).collection("computerWorkspace").doc("default") : null;
  let sandbox: any = null;
  if (ref) {
    const snap = await ref.get();
    const existingId = snap.exists ? snap.data()?.sandboxId as string | undefined : undefined;
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

export async function stopComputer(sandboxId: string, apiKey: string, uid?: string): Promise<void> {
  const daytona = new Daytona({ apiKey });
  const sandbox = await daytona.get(sandboxId).catch(() => null);
  if (sandbox) {
    if (typeof sandbox.stop === "function") await sandbox.stop(60);
    else await sandbox.delete();
  }
  // Keep the sandbox id so a later Start computer resumes the same cloud PC/files.
  if (uid) await adminDb().collection("users").doc(uid).collection("computerWorkspace").doc("default").set({ sandboxId, updatedAt: Date.now() }, { merge: true }).catch(() => undefined);
}