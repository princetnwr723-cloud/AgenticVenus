"use client";

// lib/terminalOrchestrator.ts
// Gives every agent — not just the Developer Agent — genuine shell access in
// THIS chat's own cloud workspace. Ask in plain language ("install ffmpeg",
// "what's the node version", "install this MCP's CLI") and the agent decides
// whether a real command should run, then runs it and uses the real output
// — same pattern as the MCP/plugin tool loop.

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { parseFirstJson } from "@/lib/agentJson";
import { runAgentCommand } from "@/lib/workspaceClient";

export type PlannedCommand = { command: string; reason: string };

// A short list of genuinely catastrophic patterns — the sandbox is isolated
// per chat, so the real risk here is wiping the chat's own project by
// accident, not the host machine.
const DANGEROUS = [/\brm\s+-rf\s+\/(?:\s|$)/, /:\(\)\{.*\|.*&\};:/, /\bdd\s+if=.*of=\/dev\//, /\bmkfs\./];

function transcript(messages: ChatMessage[], turns = 8): string {
  return messages
    .slice(-turns)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, m.content.startsWith("[REAL TOOL") ? 3000 : 1500)}`)
    .join("\n");
}

export async function decideTerminalCommand(
  providerId: string,
  apiKey: string,
  messages: ChatMessage[],
  hasWorkspace: boolean,
  model?: string
): Promise<PlannedCommand | null> {
  if (!hasWorkspace) return null;

  const prompt = `You have a REAL Linux shell (Node 20+, Python 3, npm, pip, git, apt with sudo) in this chat's own cloud workspace.

Conversation so far (a short follow-up like "yes do it" refers to something discussed earlier; lines starting with [REAL TOOL] are results of commands already run):
${transcript(messages)}

Decide if the LATEST user message asks for something a shell command should do RIGHT NOW — installing a tool/package/skill, checking what's installed or its version, running a script, cloning a repo, etc. Don't run a command for things that are just conversation, and don't repeat a command whose result is already shown above.
Reply with ONLY raw JSON:
{"run": boolean, "command": "the exact shell command, or null", "reason": "one short phrase, or null"}`;

  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    const parsed = parseFirstJson<{ run?: boolean; command?: string; reason?: string }>(text);
    if (!parsed?.run || !parsed.command) return null;
    if (DANGEROUS.some((re) => re.test(parsed.command!))) return null;
    return { command: parsed.command, reason: parsed.reason || "" };
  } catch {
    return null;
  }
}

export async function runPlannedCommand(command: string, scope?: string): Promise<string> {
  const result = await runAgentCommand(command, scope, 180);
  return `$ ${command}\n(exit ${result.exitCode ?? 0})\n${result.output.slice(-4000) || "(no output)"}`;
}

/** One fixed diagnostic command the Cloud Terminal's "What's installed"
 * button (and the agent, when asked "what do I have installed") both use. */
export const INSTALLED_CHECK_CMD =
  'echo "node: $(node -v 2>/dev/null || echo -)"; echo "npm: $(npm -v 2>/dev/null || echo -)"; echo "python3: $(python3 -V 2>&1 || echo -)"; echo "pip: $(pip3 -V 2>/dev/null || echo -)"; echo "git: $(git --version 2>/dev/null || echo -)"; echo "---global npm packages---"; npm ls -g --depth=0 2>/dev/null | tail -n +2; echo "---pip packages---"; pip3 list 2>/dev/null | tail -n +3 | head -30; echo "---apt (user-installed)---"; (comm -23 <(apt-mark showmanual | sort -u) <(gzip -dc /var/log/installer/initial-status.gz 2>/dev/null | sed -n "s/^Package: //p" | sort -u) 2>/dev/null | head -30) || true';