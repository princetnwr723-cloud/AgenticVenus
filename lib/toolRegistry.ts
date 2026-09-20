import { PLUGIN_TOOLS } from "@/lib/plugins";
import type { MCPServer } from "@/lib/mcp";

export type CapabilityStatus = {
  id: string;
  name: string;
  connected: boolean;
  source: "plugin" | "mcp" | "browser-profile" | "runtime" | "none";
};

const ALIASES: Record<string, string[]> = {
  gmail: ["gmail", "google mail", "email", "mail", "inbox", "send email", "reply email"],
  "google-calendar": ["calendar", "google calendar", "appointment", "meeting", "schedule"],
  "google-drive": ["drive", "google drive", "file in drive"],
  github: ["github", "git repo", "repository", "pull request", "issue"],
  slack: ["slack", "channel", "slack message"],
  notion: ["notion", "notion page", "notion database"],
  "outlook-mail": ["outlook", "outlook mail", "microsoft mail"],
};

export function findToolIdForTask(task: string, connectedToolIds: string[] = []): string | null {
  const lower = task.toLowerCase();
  if (/\b(outlook|microsoft mail)\b/i.test(lower) && connectedToolIds.includes("outlook-mail")) return "outlook-mail";
  if (/\bgmail|google mail\b/i.test(lower) && connectedToolIds.includes("gmail")) return "gmail";
  if (/\b(calendar|meeting|appointment)\b/i.test(lower) && connectedToolIds.includes("google-calendar")) return "google-calendar";
  if (/\bdrive\b/i.test(lower) && connectedToolIds.includes("google-drive")) return "google-drive";
  if (/\bgithub|repository|pull request|issue\b/i.test(lower) && connectedToolIds.includes("github")) return "github";
  if (/\bslack\b/i.test(lower) && connectedToolIds.includes("slack")) return "slack";
  if (/\bnotion\b/i.test(lower) && connectedToolIds.includes("notion")) return "notion";
  if (/\b(email|mail|inbox|send|reply)\b/i.test(lower) && connectedToolIds.includes("gmail")) return "gmail";
  for (const [id, aliases] of Object.entries(ALIASES)) {
    if (aliases.some((a) => lower.includes(a)) && connectedToolIds.includes(id)) return id;
  }
  return null;
}

export function buildCapabilityRegistry(
  pluginIds: string[],
  mcpServers: MCPServer[],
  runtime: { browser?: boolean; computer?: boolean; browserProfile?: boolean } = {},
): CapabilityStatus[] {
  const mcpText = mcpServers.map((s) => `${s.name} ${(s.tools || []).map((t) => t.name).join(" ")}`.toLowerCase()).join(" | ");
  return PLUGIN_TOOLS.map((tool) => {
    if (pluginIds.includes(tool.id)) return { id: tool.id, name: tool.name, connected: true, source: "plugin" as const };
    if (mcpText.includes(tool.id.toLowerCase()) || mcpText.includes(tool.name.toLowerCase())) return { id: tool.id, name: tool.name, connected: true, source: "mcp" as const };
    return { id: tool.id, name: tool.name, connected: false, source: "none" as const };
  }).concat([
    { id: "browser", name: "Web Browser", connected: !!runtime.browser, source: runtime.browser ? "runtime" : "none" },
    { id: "browser-profile", name: "Authenticated Browser Profile", connected: !!runtime.browserProfile, source: runtime.browserProfile ? "browser-profile" : "none" },
    { id: "computer", name: "Cloud Computer", connected: !!runtime.computer, source: runtime.computer ? "runtime" : "none" },
  ]);
}

export function connectedCapabilityIds(pluginIds: string[], mcpServers: MCPServer[]): string[] {
  return buildCapabilityRegistry(pluginIds, mcpServers).filter((c) => c.connected).map((c) => c.id);
}
