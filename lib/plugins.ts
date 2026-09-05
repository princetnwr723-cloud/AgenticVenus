// lib/plugins.ts
// Three plugin categories the workspace will support. These are shown
// with a name + color badge (no third-party logo images, to stay clear of
// trademarked brand marks) so the user can see what's coming. Wiring real
// connections is the next step, as agreed — for now these just render in
// the Plugins panel.

export type PluginCategory = "automation" | "search" | "productivity";

export type PluginTool = {
  id: string;
  name: string;
  category: PluginCategory;
  description: string;
  color: string;
};

export const PLUGIN_CATEGORIES: { id: PluginCategory; label: string; blurb: string }[] = [
  {
    id: "automation",
    label: "Automation",
    blurb: "Trigger workflows in tools you already use.",
  },
  {
    id: "search",
    label: "Search & Data",
    blurb: "Let the agent pull in live information.",
  },
  {
    id: "productivity",
    label: "Productivity",
    blurb: "Read and write to your everyday work tools.",
  },
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

  // Productivity
  { id: "slack", name: "Slack", category: "productivity", description: "Read and send Slack messages.", color: "#4A154B" },
  { id: "notion", name: "Notion", category: "productivity", description: "Read and write Notion pages.", color: "#000000" },
  { id: "google-workspace", name: "Google Workspace", category: "productivity", description: "Gmail, Calendar, Docs access.", color: "#4285F4" },
];
