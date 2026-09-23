"use client";

import { auth } from "@/lib/firebase";

/** Fired after every file write so open panels (Codespace) refresh instantly. */
export const WORKSPACE_CHANGED_EVENT = "av:workspace-changed";

function announceChange(scope?: string) {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(WORKSPACE_CHANGED_EVENT, { detail: { scope } }));
}

async function request<T>(body: Record<string, unknown>): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not signed in.");
  const res = await fetch("/api/workspace", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || "Workspace operation failed.");
  return data as T;
}

export type WorkspaceInfo = { sandboxId: string; state?: string; workDir?: string; updatedAt: number };
export type CommandResult = { sandboxId: string; command: string; cwd: string; exitCode?: number; output: string };
export type WorkspaceFile = { path: string; content?: string; size?: number };
export type SessionResult = { sandboxId: string; sessionId: string; cmdId?: string; exitCode?: number; output?: string; stdout?: string; stderr?: string };

export async function ensureAgentWorkspace() {
  const data = await request<{ workspace: WorkspaceInfo }>({ action: "ensure" });
  return data.workspace;
}

/** scope is normally a chatId — leave it out (or pass "global") for the
 * shared Cloud Terminal panel, which isn't tied to one specific chat. */
export async function listAgentFiles(includeContent = false, scope?: string) {
  const data = await request<{ files: WorkspaceFile[] }>({ action: "list", includeContent, scope });
  return data.files;
}

export async function runAgentCommand(command: string, scope?: string, timeout = 120) {
  const data = await request<{ result: CommandResult }>({ action: "exec", command, scope, timeout });
  return data.result;
}

export async function runAgentSessionCommand(command: string, sessionId = "agenticvenus-terminal", scope?: string, runAsync = false) {
  const data = await request<{ result: SessionResult }>({ action: "sessionExec", sessionId, command, scope, runAsync });
  return data.result;
}

export async function getAgentSessionLogs(sessionId: string, cmdId: string) {
  const data = await request<{ result: { output: string } }>({ action: "sessionLogs", sessionId, cmdId });
  return data.result.output;
}

export async function listAgentPorts() {
  const data = await request<{ ports: number[] }>({ action: "ports" });
  return data.ports;
}

/** Frees a specific port (kills whatever is bound to it) before starting a
 * dev server there — scoped to one port, never a broad process-name kill, so
 * other chats' dev servers in the same sandbox are untouched. */
export async function freeAgentPort(port: number) {
  await request<{ ok: true }>({ action: "freePort", port });
}

export async function writeAgentFile(path: string, content: string, scope?: string) {
  const result = await request<{ result: { sandboxId: string; path: string } }>({ action: "write", path, content, scope });
  announceChange(scope);
  return result;
}

export async function readAgentFile(path: string, scope?: string) {
  const data = await request<{ result: { content: string; path: string } }>({ action: "read", path, scope });
  return data.result;
}

export async function getAgentPreview(port = 3000) {
  const data = await request<{ result: { sandboxId: string; port: number; url: string } }>({ action: "preview", port });
  return data.result;
}