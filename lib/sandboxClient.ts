// lib/sandboxClient.ts
// Client-side glue for Codespace's "Run in Cloud" — starts a sandbox,
// then polls until the server is actually ready (real installs can take
// well over a minute, so this isn't a single blocking call).

import { auth } from "@/lib/firebase";
import type { CodeFile } from "@/lib/codeExtract";

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

export async function startCloudPreview(files: CodeFile[]): Promise<{ sandboxId: string }> {
  const res = await fetch("/api/sandbox/start", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ files }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to start the cloud sandbox.");
  return { sandboxId: data.sandboxId };
}

async function checkStatus(sandboxId: string): Promise<{ ready: boolean; previewUrl?: string; log?: string }> {
  const res = await fetch("/api/sandbox/status", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ sandboxId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to check sandbox status.");
  return data;
}

/** Polls until the sandbox's server is ready, calling onProgress with
 * each check's log tail so the UI can show what's happening. Gives up
 * after `timeoutMs` (default 2 minutes). */
export async function waitForCloudPreview(
  sandboxId: string,
  onProgress?: (log: string, elapsedMs: number) => void,
  timeoutMs = 120_000
): Promise<string> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const status = await checkStatus(sandboxId);
    if (status.ready && status.previewUrl) return status.previewUrl;
    onProgress?.(status.log || "", Date.now() - start);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error(
    "The sandbox is still starting after 2 minutes — it may need a different start command, or the project may have an error. Check the log above, or your run.sh."
  );
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