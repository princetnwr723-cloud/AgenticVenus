// lib/sandboxClient.ts
// Client-side calls into /api/sandbox/* — used by Codespace's "Run in
// Cloud" button.

import { auth } from "@/lib/firebase";
import type { CodeFile } from "@/lib/codeExtract";

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

export async function startCloudPreview(files: CodeFile[]): Promise<{ sandboxId: string; previewUrl: string }> {
  const res = await fetch("/api/sandbox/start", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ files }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to start the cloud sandbox.");
  return { sandboxId: data.sandboxId, previewUrl: data.previewUrl };
}

export async function stopCloudPreview(sandboxId: string): Promise<void> {
  try {
    await fetch("/api/sandbox/stop", {
      method: "POST",
      headers: await authedHeaders(),
      body: JSON.stringify({ sandboxId }),
    });
  } catch {
    // Best-effort — sandbox will time out on its own anyway.
  }
}