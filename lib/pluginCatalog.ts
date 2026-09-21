// lib/pluginCatalog.ts
// Client-safe list of the real actions each connected plugin can perform.
// The agent's planner (lib/pluginOrchestrator.ts) reads this list; the actual
// HTTP work lives server-side in lib/pluginActions.ts.
//
// WHY THE AGENT "COULD NOT USE PLUGINS" BEFORE: only 3 Gmail actions existed.
// Every other plugin (Calendar, Drive, Outlook, Slack, Notion, GitHub …) could
// be "connected" but had no action the agent could call. Now every OAuth /
// API-key plugin in the Plugins panel has real actions.
//
// Parameter descriptions containing "(optional)" are not required.

export type PluginActionDef = {
  id: string;
  toolId: string;
  name: string;
  description: string;
  params: Record<string, string>;
  /** true = changes something in the outside world (send / create / post) */
  write?: boolean;
  /** true = needs no login or key, works as soon as the plugin is switched on */
  noAuth?: boolean;
};

export type PluginCredential = {
  accessToken?: string;
  apiKey?: string;
  meta?: Record<string, any>;
};

function def(
  id: string,
  toolId: string,
  name: string,
  description: string,
  params: Record<string, string> = {},
  opts: { write?: boolean; noAuth?: boolean } = {}
): PluginActionDef {
  return { id, toolId, name, description, params, ...opts };
}

const TZ = "IANA time zone, e.g. Asia/Kolkata (optional)";

export const PLUGIN_ACTIONS: PluginActionDef[] = [
  // ---------- Gmail ----------
  def("gmail.list_messages", "gmail", "Search Gmail", "Search or list recent Gmail messages (returns ids to read).", {
    query: "Gmail search query, e.g. 'is:unread' or 'from:x@y.com' (optional)",
  }),
  def("gmail.read_message", "gmail", "Read Gmail message", "Read the full text of one Gmail message by id.", { id: "message id from a search" }),
  def("gmail.send_email", "gmail", "Send Gmail", "Send an email right now from the user's Gmail account.", { to: "recipient email", subject: "subject", body: "plain text body" }, { write: true }),
  def("gmail.create_draft", "gmail", "Create Gmail draft", "Create a draft in Gmail without sending it.", { to: "recipient email", subject: "subject", body: "plain text body" }, { write: true }),

  // ---------- Google Calendar ----------
  def("google-calendar.list_events", "google-calendar", "List calendar events", "List upcoming Google Calendar events.", {
    timeMin: "start ISO date-time (optional, default now)",
    timeMax: "end ISO date-time (optional, default +7 days)",
  }),
  def(
    "google-calendar.create_event",
    "google-calendar",
    "Create calendar event",
    "Create an event on the user's primary Google Calendar.",
    {
      summary: "event title",
      start: "ISO date-time like 2026-09-21T15:00:00 (or YYYY-MM-DD for all-day)",
      end: "ISO date-time (or YYYY-MM-DD)",
      description: "details (optional)",
      location: "place (optional)",
      attendees: "comma separated emails (optional)",
      timeZone: TZ,
    },
    { write: true }
  ),

  // ---------- Google Drive ----------
  def("google-drive.search", "google-drive", "Search Drive", "Search Google Drive files by name or content.", { query: "text to search for" }),
  def("google-drive.read_file", "google-drive", "Read Drive file", "Read the text of a Google Doc/Sheet/Slides or a text file by id.", { fileId: "file id from a search" }),
  def("google-drive.create_doc", "google-drive", "Create Google Doc", "Create a new Google Doc containing the given text.", { name: "document title", content: "document text" }, { write: true }),

  // ---------- Outlook ----------
  def("outlook-mail.list_messages", "outlook-mail", "Search Outlook mail", "List or search recent Outlook messages.", { query: "search text (optional)" }),
  def("outlook-mail.read_message", "outlook-mail", "Read Outlook message", "Read one Outlook message by id.", { id: "message id from a search" }),
  def("outlook-mail.send_email", "outlook-mail", "Send Outlook email", "Send an email from the user's Outlook account.", { to: "recipient email", subject: "subject", body: "plain text body" }, { write: true }),
  def("outlook-mail.create_draft", "outlook-mail", "Create Outlook draft", "Save a draft in Outlook without sending.", { to: "recipient email", subject: "subject", body: "plain text body" }, { write: true }),
  def("outlook-calendar.list_events", "outlook-calendar", "List Outlook events", "List upcoming Outlook calendar events.", {
    timeMin: "start ISO date-time (optional, default now)",
    timeMax: "end ISO date-time (optional, default +7 days)",
  }),
  def(
    "outlook-calendar.create_event",
    "outlook-calendar",
    "Create Outlook event",
    "Create an event on the user's Outlook calendar.",
    { summary: "event title", start: "ISO date-time", end: "ISO date-time", description: "details (optional)", attendees: "comma separated emails (optional)", timeZone: TZ },
    { write: true }
  ),
  def("onedrive.search", "onedrive", "Search OneDrive", "Search OneDrive files by name.", { query: "text to search for" }),
  def("ms-teams.list_chats", "ms-teams", "List Teams chats", "List the user's recent Microsoft Teams chats (returns chat ids).", {}),
  def("ms-teams.send_chat_message", "ms-teams", "Send Teams message", "Send a message into a Teams chat.", { chatId: "chat id from list_chats", text: "message text" }, { write: true }),

  // ---------- Notion ----------
  def("notion.search", "notion", "Search Notion", "Search pages and databases in Notion.", { query: "text to search for (optional)" }),
  def("notion.get_page", "notion", "Read Notion page", "Read the text content of a Notion page by id.", { pageId: "page id from a search" }),
  def("notion.create_page", "notion", "Create Notion page", "Create a new page inside an existing Notion page.", { parentPageId: "id of the parent page", title: "page title", content: "page text, one paragraph per line" }, { write: true }),

  // ---------- Slack ----------
  def("slack.list_channels", "slack", "List Slack channels", "List public Slack channels (returns ids).", {}),
  def("slack.post_message", "slack", "Post to Slack", "Post a message to a Slack channel.", { channel: "channel id (or #name)", text: "message text" }, { write: true }),
  def("slack.read_history", "slack", "Read Slack channel", "Read the latest messages in a Slack channel.", { channel: "channel id", limit: "how many messages, max 20 (optional)" }),

  // ---------- GitHub ----------
  def("github.list_repos", "github", "List GitHub repos", "List the user's most recently updated repositories.", {}),
  def("github.list_issues", "github", "List GitHub issues", "List issues in a repository.", { repo: "owner/name", state: "open, closed or all (optional)" }),
  def("github.create_issue", "github", "Create GitHub issue", "Open a new issue in a repository.", { repo: "owner/name", title: "issue title", body: "issue text (optional)" }, { write: true }),
  def("github.list_pull_requests", "github", "List pull requests", "List pull requests in a repository.", { repo: "owner/name", state: "open, closed or all (optional)" }),
  def("github.get_file", "github", "Read GitHub file", "Read a file (or list a folder) from a repository.", { repo: "owner/name", path: "path inside the repo", ref: "branch or commit (optional)" }),

  // ---------- Linear ----------
  def("linear.list_issues", "linear", "List Linear issues", "List the most recently updated Linear issues.", {}),
  def("linear.list_teams", "linear", "List Linear teams", "List Linear teams (returns team ids).", {}),
  def("linear.create_issue", "linear", "Create Linear issue", "Create a Linear issue in a team.", { teamId: "team id from list_teams", title: "issue title", description: "issue text (optional)" }, { write: true }),

  // ---------- CRM ----------
  def("hubspot.search_contacts", "hubspot", "Search HubSpot contacts", "Search HubSpot contacts by name, email or company.", { query: "search text" }),
  def("hubspot.create_contact", "hubspot", "Create HubSpot contact", "Create a contact in HubSpot.", { email: "email", firstname: "first name (optional)", lastname: "last name (optional)", phone: "phone (optional)", company: "company (optional)" }, { write: true }),
  def("salesforce.query", "salesforce", "Query Salesforce", "Run a read-only SOQL query, e.g. SELECT Id, Name FROM Account LIMIT 10.", { soql: "SOQL query" }),

  // ---------- Search & data ----------
  def("web-search.search", "web-search", "Search the web", "Search the live web and get titles, links and snippets.", { query: "search query" }, { noAuth: true }),
  def("web-search.fetch_page", "web-search", "Read a web page", "Download a public web page and return its readable text.", { url: "https://..." }, { noAuth: true }),
  def("perplexity-search.search", "perplexity-search", "Perplexity answer", "Get a search-grounded answer with sources from Perplexity.", { query: "question" }),
  def("wolfram.query", "wolfram", "Wolfram Alpha", "Ask Wolfram Alpha a math / science / data question.", { input: "the question, in plain English" }),
];