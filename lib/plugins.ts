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