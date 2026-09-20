// lib/plugins.ts
// The full plugin catalog — expanded to match what Grok's own connector
// ecosystem supports (Gmail, Calendar, Drive, Outlook, Notion, GitHub,
// Slack, Salesforce, HubSpot, etc.), organized into categories. No
// third-party logo images are used (trademark/brand-mark safety) — each
// tool gets a colored initial badge in its real brand color instead.
//
// NOTE: "Connect" here marks a tool as connected in Firestore so the
// agent knows it has access to it (see lib/pluginConnections.ts) — it's
// not yet wired to each service's real OAuth flow. That's the next step;
// for now this is what lets the rest of the tool-awareness system work.

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";

export type ToolNeed = {
  toolId: string | null;
  toolName: string;
  known: boolean;
  connected: boolean;
};

function extractToolJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

function toolTranscript(messages: ChatMessage[], turns = 8): string {
  return messages
    .slice(-turns)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
}

function deterministicToolId(task: string, connectedToolIds: string[]): string | null {
  const lower = task.toLowerCase();
  const has = (id: string) => connectedToolIds.includes(id);
  if (/\b(outlook|microsoft mail)\b/.test(lower) && has("outlook-mail")) return "outlook-mail";
  if (/\bgmail|google mail\b/.test(lower) && has("gmail")) return "gmail";
  if (/\b(calendar|meeting|appointment)\b/.test(lower) && has("google-calendar")) return "google-calendar";
  if (/\bdrive\b/.test(lower) && has("google-drive")) return "google-drive";
  if (/\bgithub|repository|pull request|issue\b/.test(lower) && has("github")) return "github";
  if (/\bslack\b/.test(lower) && has("slack")) return "slack";
  if (/\bnotion\b/.test(lower) && has("notion")) return "notion";
  if (/\b(email|mail|inbox|send|reply)\b/.test(lower) && has("gmail")) return "gmail";
  return null;
}

export async function detectToolNeed(
  providerId: string,
  apiKey: string,
  messages: ChatMessage[],
  connectedToolIds: string[],
  model?: string
): Promise<ToolNeed | null> {
  const latest = messages[messages.length - 1]?.content || "";
  const deterministic = deterministicToolId(latest, connectedToolIds);
  if (deterministic) {
    const tool = PLUGIN_TOOLS.find((t) => t.id === deterministic);
    return {
      toolId: deterministic,
      toolName: tool?.name || deterministic,
      known: true,
      connected: true,
    };
  }

  const catalog = PLUGIN_TOOLS.map((t) => `${t.id}: ${t.name} — ${t.description}`).join("\n");
  const prompt = `Decide if the latest message requires an external tool/account. Use the conversation for context.\n\nConversation:\n${toolTranscript(messages)}\n\nTool catalog:\n${catalog}\n\nReply ONLY JSON: {"needsTool": boolean, "toolId": "catalog id or null", "toolName": "human name or empty"}`;
  try {
    const { text } = await sendChatMessage({
      providerId,
      apiKey,
      messages: [{ role: "user", content: prompt }],
      model,
    });
    const parsed = JSON.parse(extractToolJson(text));
    if (!parsed?.needsTool) return null;
    const known = !!parsed.toolId && PLUGIN_TOOLS.some((t) => t.id === parsed.toolId);
    return {
      toolId: known ? parsed.toolId : null,
      toolName: parsed.toolName || parsed.toolId || "this tool",
      known,
      connected: known ? connectedToolIds.includes(parsed.toolId) : false,
    };
  } catch {
    return null;
  }
}

export type PluginCategory =
  | "automation"
  | "search"
  | "files"
  | "communication"
  | "dev"
  | "business";

export type PluginTool = {
  id: string;
  name: string;
  category: PluginCategory;
  description: string;
  color: string;
  /** If a real official/public MCP server exists for this tool, its URL —
   * "Connect" then opens the real MCP connect flow (same as MCP Tools)
   * instead of the placeholder toggle. */
  mcpUrl?: string;
};

export const PLUGIN_CATEGORIES: { id: PluginCategory; label: string; blurb: string }[] = [
  { id: "automation", label: "Automation", blurb: "Trigger workflows in tools you already use." },
  { id: "search", label: "Search & Data", blurb: "Let the agent pull in live information." },
  { id: "files", label: "Email, Calendar & Files", blurb: "Read and manage your everyday accounts." },
  { id: "communication", label: "Communication", blurb: "Message teammates directly from chat." },
  { id: "dev", label: "Developer Tools", blurb: "Work with code, issues, and deployments." },
  { id: "business", label: "CRM & Business", blurb: "Touch customer and sales data." },
];

export const PLUGIN_TOOLS: PluginTool[] = [
  // Automation
  { id: "zapier", name: "Zapier", category: "automation", description: "Trigger any Zap from a chat.", color: "#FF4A00" },
  { id: "make", name: "Make", category: "automation", description: "Run Make.com scenarios.", color: "#6D00CC" },
  { id: "n8n", name: "n8n", category: "automation", description: "Trigger self-hosted n8n workflows.", color: "#EA4B71" },

  // Search & Data
  { id: "web-search", name: "Web Search", category: "search", description: "Live web search results.", color: "#4285F4" },
  { id: "perplexity-search", name: "Perplexity Search", category: "search", description: "Search-grounded answers.", color: "#20808D" },
  { id: "wolfram", name: "Wolfram Alpha", category: "search", description: "Computational & math data.", color: "#DD1100" },

  // Email, Calendar & Files
  { id: "gmail", name: "Gmail", category: "files", description: "Read and send email.", color: "#EA4335", mcpUrl: "https://gmailmcp.googleapis.com/mcp/v1" },
  { id: "google-calendar", name: "Google Calendar", category: "files", description: "Check and create events.", color: "#4285F4" },
  { id: "google-drive", name: "Google Drive", category: "files", description: "Docs, Sheets, and Slides.", color: "#0F9D58" },
  { id: "outlook-mail", name: "Outlook Mail", category: "files", description: "Read and send Outlook email.", color: "#0078D4" },
  { id: "outlook-calendar", name: "Outlook Calendar", category: "files", description: "Manage Outlook events.", color: "#0078D4" },
  { id: "onedrive", name: "OneDrive", category: "files", description: "Access Microsoft cloud files.", color: "#094AB2" },
  { id: "sharepoint", name: "SharePoint", category: "files", description: "Company document libraries.", color: "#038387" },
  { id: "notion", name: "Notion", category: "files", description: "Read and write Notion pages.", color: "#000000", mcpUrl: "https://mcp.notion.com/mcp" },

  // Communication
  { id: "slack", name: "Slack", category: "communication", description: "Read and send Slack messages.", color: "#4A154B" },
  { id: "ms-teams", name: "Microsoft Teams", category: "communication", description: "Message teams and channels.", color: "#6264A7" },

  // Developer Tools
  { id: "github", name: "GitHub", category: "dev", description: "Issues, PRs, and repos.", color: "#181717", mcpUrl: "https://api.githubcopilot.com/mcp/" },
  { id: "linear", name: "Linear", category: "dev", description: "Track and update issues.", color: "#5E6AD2" },
  { id: "vercel", name: "Vercel", category: "dev", description: "Check deploys and projects.", color: "#000000" },

  // CRM & Business
  { id: "salesforce", name: "Salesforce", category: "business", description: "CRM records and pipeline.", color: "#00A1E0" },
  { id: "hubspot", name: "HubSpot", category: "business", description: "Contacts, deals, and marketing.", color: "#FF7A59" },
  { id: "canva", name: "Canva", category: "business", description: "Generate and edit designs.", color: "#00C4CC" },
];