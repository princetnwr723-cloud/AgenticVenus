"use client";

import { auth } from "@/lib/firebase";

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not signed in.");
  const res = await fetch("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Workspace operation failed.");
  return data as T;
}

export type WorkspaceInfo = { sandboxId: string; state?: string; workDir?: string; projectDir: string; updatedAt: number };
export type CommandResult = { sandboxId: string; command: string; cwd: string; exitCode?: number; output: string };
export type WorkspaceFile = { path: string; content?: string; size?: number };

export async function ensureAgentWorkspace() {
  const data = await request<{ workspace: WorkspaceInfo }>({ action: "ensure" });
  return data.workspace;
}

export async function listAgentFiles(includeContent = false) {
  const data = await request<{ files: WorkspaceFile[] }>({ action: "list", includeContent });
  return data.files;
}

export async function runAgentCommand(command: string, cwd = "workspace", timeout = 120) {
  const data = await request<{ result: CommandResult }>({ action: "exec", command, cwd, timeout });
  return data.result;
}

export async function runAgentSessionCommand(command: string, sessionId = "agenticvenus-terminal", runAsync = false) {
  const data = await request<{ result: { sandboxId: string; sessionId: string; cmdId: string; exitCode?: number; output?: string; stdout?: string; stderr?: string } }>({ action: "sessionExec", sessionId, command, runAsync });
  return data.result;
}

export async function writeAgentFile(path: string, content: string) {
  return request<{ result: { sandboxId: string; path: string } }>({ action: "write", path, content });
}

export async function readAgentFile(path: string) {
  const data = await request<{ result: { content: string; path: string } }>({ action: "read", path });
  return data.result;
}

export async function getAgentPreview(port = 3000) {
  const data = await request<{ result: { sandboxId: string; port: number; url: string } }>({ action: "preview", port });
  return data.result;
}
