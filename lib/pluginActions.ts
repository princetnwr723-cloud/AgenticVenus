// lib/pluginActions.ts
// The real work each connected plugin can do. SERVER-SIDE ONLY (it receives the
// user's access token / API key, which must never reach the browser).
//
// The list of actions lives in lib/pluginCatalog.ts (client-safe). To add a new
// action: describe it there, then add a handler with the same id in HANDLERS.
// Credentials are resolved + refreshed by lib/pluginRuntime.ts.

import { PLUGIN_ACTIONS, type PluginActionDef, type PluginCredential } from "@/lib/pluginCatalog";

// Re-exported so older imports of "@/lib/pluginActions" keep working.
export { PLUGIN_ACTIONS };
export type { PluginActionDef, PluginCredential };

const UA = "Mozilla/5.0 (compatible; AgenticVenus/1.0; +https://agenticvenus.app)";
const clip = (s: string, n = 6000) => (s.length > n ? `${s.slice(0, n)}\n…(truncated)` : s);
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

type HttpOpts = {
  method?: string;
  token?: string;
  headers?: Record<string, string>;
  json?: unknown;
  body?: string;
  form?: Record<string, string>;
};

async function http(url: string, opts: HttpOpts = {}): Promise<any> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  let body: string | undefined = opts.body;
  if (opts.json !== undefined) {
    headers["content-type"] = headers["content-type"] || "application/json";
    body = JSON.stringify(opts.json);
  } else if (opts.form) {
    headers["content-type"] = "application/x-www-form-urlencoded";
    body = new URLSearchParams(opts.form).toString();
  }
  const res = await fetch(url, { method: opts.method || (body ? "POST" : "GET"), headers, body });
  const raw = await res.text();
  let data: any = raw;
  if ((res.headers.get("content-type") || "").includes("json") || /^\s*[\[{]/.test(raw)) {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  }
  if (!res.ok) {
    const message =
      data?.error?.message ||
      data?.error_description ||
      data?.message ||
      (typeof data?.error === "string" ? data.error : "") ||
      (typeof data === "string" ? data.slice(0, 200) : "") ||
      res.statusText;
    throw new Error(`${res.status}: ${message}`);
  }
  return data;
}

function token(c: PluginCredential): string {
  if (!c.accessToken) throw new Error("This plugin isn't connected yet — connect it in Plugins first.");
  return c.accessToken;
}

function isoOrThrow(value: string | undefined, fallback: Date): string {
  const d = value ? new Date(value) : fallback;
  if (Number.isNaN(d.getTime())) throw new Error(`Invalid date: ${value}`);
  return d.toISOString();
}

function b64url(s: string) {
  return Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

// ---------------------------------------------------------------- Gmail
function buildRawMessage(to: string, subject: string, body: string): string {
  const encodedSubject = /^[\x20-\x7e]*$/.test(subject) ? subject : `=?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`;
  const encodedBody = (Buffer.from(body, "utf8").toString("base64").match(/.{1,76}/g) || []).join("\r\n");
  const message = [
    `To: ${to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    encodedBody,
  ].join("\r\n");
  return b64url(message);
}

function gmailBody(payload: any): string {
  if (!payload) return "";
  const decode = (d?: string) => (d ? Buffer.from(d.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8") : "");
  if (payload.mimeType === "text/plain" && payload.body?.data) return decode(payload.body.data);
  for (const part of payload.parts || []) {
    const text = gmailBody(part);
    if (text) return text;
  }
  if (payload.body?.data) return decode(payload.body.data).replace(/<[^>]+>/g, " ");
  return "";
}

const GMAIL = "https://gmail.googleapis.com/gmail/v1/users/me";

// ---------------------------------------------------------------- web helpers
const decodeEntities = (s: string) =>
  s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
const stripTags = (s: string) => decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

function assertPublicUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("That isn't a valid URL.");
  }
  if (!/^https?:$/.test(url.protocol)) throw new Error("Only http(s) URLs can be fetched.");
  const host = url.hostname.toLowerCase();
  const privateV4 = /^(127\.|10\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
  if (
    host === "localhost" ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    privateV4.test(host) ||
    host === "[::1]" ||
    host.startsWith("[fc") ||
    host.startsWith("[fd") ||
    host.startsWith("[fe80")
  ) {
    throw new Error("Private or local addresses can't be fetched.");
  }
  return url;
}

async function webSearch(query: string): Promise<string> {
  const results: { title: string; url: string; snippet: string }[] = [];

  try {
    const res = await fetch("https://html.duckduckgo.com/html/", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "user-agent": UA },
      body: new URLSearchParams({ q: query }).toString(),
    });
    const html = await res.text();
    const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < 8) {
      let link = decodeEntities(m[1]);
      try {
        const u = new URL(link.startsWith("//") ? `https:${link}` : link);
        link = u.searchParams.get("uddg") || u.toString();
      } catch {}
      results.push({ title: stripTags(m[2]), url: link, snippet: stripTags(m[3]) });
    }
  } catch {
    // fall through to Bing
  }

  if (results.length === 0) {
    const res = await fetch(`https://www.bing.com/search?q=${encodeURIComponent(query)}`, { headers: { "user-agent": UA, "accept-language": "en" } });
    const html = await res.text();
    const re = /<li class="b_algo"[\s\S]*?<h2[^>]*><a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>([\s\S]*?)<\/li>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) && results.length < 8) {
      const snippet = m[3].match(/<p[^>]*>([\s\S]*?)<\/p>/)?.[1] || "";
      results.push({ title: stripTags(m[2]), url: decodeEntities(m[1]), snippet: stripTags(snippet) });
    }
  }

  if (!results.length) return `No web results found for "${query}".`;
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n");
}

async function fetchPage(rawUrl: string): Promise<string> {
  let url = assertPublicUrl(rawUrl);
  let res: Response | null = null;
  for (let hop = 0; hop < 4; hop++) {
    res = await fetch(url.toString(), { redirect: "manual", headers: { "user-agent": UA, accept: "text/html,text/plain,application/json;q=0.9,*/*;q=0.5" } });
    const next = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && next) {
      url = assertPublicUrl(new URL(next, url).toString());
      continue;
    }
    break;
  }
  if (!res || !res.ok) throw new Error(`The page responded with ${res?.status ?? "no response"}.`);
  const raw = (await res.text()).slice(0, 600_000);
  const type = res.headers.get("content-type") || "";
  if (!type.includes("html")) return clip(raw, 8000);
  const title = raw.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  const text = decodeEntities(
    raw
      .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr|br|section|article)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n\n")
    .trim();
  return clip(`${title ? `TITLE: ${stripTags(title)}\n\n` : ""}${text}`, 8000);
}

// ---------------------------------------------------------------- Notion / Slack / GitHub / Linear helpers
const notionHeaders = { "Notion-Version": "2022-06-28" };

function notionTitle(item: any): string {
  if (item.object === "database") return (item.title || []).map((t: any) => t.plain_text).join("") || "(untitled database)";
  const prop = Object.values(item.properties || {}).find((p: any) => p.type === "title") as any;
  return (prop?.title || []).map((t: any) => t.plain_text).join("") || "(untitled)";
}

async function slack(method: string, c: PluginCredential, payload: Record<string, unknown> = {}) {
  const data = await http(`https://slack.com/api/${method}`, { token: token(c), json: payload });
  if (!data.ok) {
    const hint = data.error === "not_in_channel" ? " — invite the bot to that channel first (/invite @AgenticVenus)." : "";
    throw new Error(`Slack: ${data.error}${hint}`);
  }
  return data;
}

function ghRepo(repo: string): string {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || "")) throw new Error('repo must look like "owner/name".');
  return repo;
}
const gh = (c: PluginCredential, path: string, init: Omit<HttpOpts, "token" | "headers"> = {}) =>
  http(`https://api.github.com${path}`, {
    ...init,
    token: token(c),
    headers: { accept: "application/vnd.github+json", "user-agent": "AgenticVenus", "x-github-api-version": "2022-11-28" },
  });

async function linear(c: PluginCredential, query: string, variables: Record<string, unknown> = {}) {
  const data = await http("https://api.linear.app/graphql", { token: token(c), json: { query, variables } });
  if (data.errors?.length) throw new Error(`Linear: ${data.errors[0].message}`);
  return data.data;
}

const GRAPH = "https://graph.microsoft.com/v1.0";
const graph = (c: PluginCredential, path: string, init: HttpOpts = {}) => http(`${GRAPH}${path}`, { ...init, token: token(c) });

// ---------------------------------------------------------------- handlers
type Handler = (c: PluginCredential, p: Record<string, any>) => Promise<string>;

const HANDLERS: Record<string, Handler> = {
  // ---- Gmail
  "gmail.list_messages": async (c, p) => {
    const url = new URL(`${GMAIL}/messages`);
    if (p.query) url.searchParams.set("q", String(p.query));
    url.searchParams.set("maxResults", "8");
    const list = await http(url.toString(), { token: token(c) });
    if (!list.messages?.length) return "No messages found.";
    const rows = await Promise.all(
      list.messages.slice(0, 8).map((m: any) =>
        http(`${GMAIL}/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, { token: token(c) })
      )
    );
    return rows
      .map((d: any) => {
        const h = (n: string) => d.payload?.headers?.find((x: any) => x.name === n)?.value || "";
        return `id: ${d.id} | From: ${h("From") || "(unknown)"} | Date: ${h("Date")} | Subject: ${h("Subject") || "(no subject)"} | ${d.snippet}`;
      })
      .join("\n");
  },
  "gmail.read_message": async (c, p) => {
    const d = await http(`${GMAIL}/messages/${encodeURIComponent(p.id)}?format=full`, { token: token(c) });
    const h = (n: string) => d.payload?.headers?.find((x: any) => x.name === n)?.value || "";
    return clip(`From: ${h("From")}\nTo: ${h("To")}\nDate: ${h("Date")}\nSubject: ${h("Subject")}\n\n${gmailBody(d.payload) || d.snippet}`);
  },
  "gmail.send_email": async (c, p) => {
    await http(`${GMAIL}/messages/send`, { token: token(c), json: { raw: buildRawMessage(p.to, p.subject, p.body) } });
    return `Email sent to ${p.to} with subject "${p.subject}".`;
  },
  "gmail.create_draft": async (c, p) => {
    await http(`${GMAIL}/drafts`, { token: token(c), json: { message: { raw: buildRawMessage(p.to, p.subject, p.body) } } });
    return `Draft created for ${p.to} with subject "${p.subject}".`;
  },

  // ---- Google Calendar
  "google-calendar.list_events": async (c, p) => {
    const now = new Date();
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "20");
    url.searchParams.set("timeMin", isoOrThrow(p.timeMin, now));
    url.searchParams.set("timeMax", isoOrThrow(p.timeMax, new Date(now.getTime() + 7 * 86400000)));
    const data = await http(url.toString(), { token: token(c) });
    if (!data.items?.length) return "No events in that range.";
    return data.items
      .map((e: any) => `${e.id} | ${e.start?.dateTime || e.start?.date} → ${e.end?.dateTime || e.end?.date} | ${e.summary || "(no title)"}${e.location ? ` @ ${e.location}` : ""}`)
      .join("\n");
  },
  "google-calendar.create_event": async (c, p) => {
    const tz = p.timeZone || "UTC";
    const when = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? { date: v } : { dateTime: v, timeZone: tz });
    const attendees = String(p.attendees || "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((email) => ({ email }));
    const event = await http(`https://www.googleapis.com/calendar/v3/calendars/primary/events${attendees.length ? "?sendUpdates=all" : ""}`, {
      token: token(c),
      json: { summary: p.summary, description: p.description, location: p.location, start: when(p.start), end: when(p.end), ...(attendees.length ? { attendees } : {}) },
    });
    return `Event "${p.summary}" created. ${event.htmlLink || ""}`.trim();
  },

  // ---- Google Drive
  "google-drive.search": async (c, p) => {
    const q = esc(String(p.query || ""));
    const url = new URL("https://www.googleapis.com/drive/v3/files");
    url.searchParams.set("q", `(name contains '${q}' or fullText contains '${q}') and trashed=false`);
    url.searchParams.set("pageSize", "10");
    url.searchParams.set("fields", "files(id,name,mimeType,modifiedTime,webViewLink)");
    const data = await http(url.toString(), { token: token(c) });
    if (!data.files?.length) return "No files found.";
    return data.files.map((f: any) => `id: ${f.id} | ${f.name} | ${f.mimeType} | modified ${f.modifiedTime} | ${f.webViewLink || ""}`).join("\n");
  },
  "google-drive.read_file": async (c, p) => {
    const meta = await http(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.fileId)}?fields=id,name,mimeType`, { token: token(c) });
    const exportAs: Record<string, string> = {
      "application/vnd.google-apps.document": "text/plain",
      "application/vnd.google-apps.spreadsheet": "text/csv",
      "application/vnd.google-apps.presentation": "text/plain",
    };
    let text: any;
    if (exportAs[meta.mimeType]) {
      text = await http(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.fileId)}/export?mimeType=${encodeURIComponent(exportAs[meta.mimeType])}`, { token: token(c) });
    } else if (/^text\/|json|xml|javascript|markdown/.test(meta.mimeType)) {
      text = await http(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(p.fileId)}?alt=media`, { token: token(c) });
    } else {
      return `"${meta.name}" is a ${meta.mimeType} file — its content can't be read as text.`;
    }
    return clip(`FILE: ${meta.name}\n\n${typeof text === "string" ? text : JSON.stringify(text, null, 2)}`, 8000);
  },
  "google-drive.create_doc": async (c, p) => {
    const boundary = `av${Date.now()}`;
    const body =
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
      `${JSON.stringify({ name: p.name, mimeType: "application/vnd.google-apps.document" })}\r\n` +
      `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\n\r\n${p.content}\r\n--${boundary}--`;
    const file = await http("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink", {
      token: token(c),
      headers: { "content-type": `multipart/related; boundary=${boundary}` },
      body,
    });
    return `Created Google Doc "${file.name}". ${file.webViewLink || ""}`.trim();
  },

  // ---- Outlook mail
  "outlook-mail.list_messages": async (c, p) => {
    const url = new URL(`${GRAPH}/me/messages`);
    url.searchParams.set("$top", "8");
    url.searchParams.set("$select", "id,subject,from,receivedDateTime,bodyPreview");
    if (p.query) url.searchParams.set("$search", `"${String(p.query).replace(/"/g, "")}"`);
    else url.searchParams.set("$orderby", "receivedDateTime desc");
    const data = await http(url.toString(), { token: token(c) });
    if (!data.value?.length) return "No messages found.";
    return data.value
      .map((m: any) => `id: ${m.id} | From: ${m.from?.emailAddress?.name || ""} <${m.from?.emailAddress?.address || ""}> | ${m.receivedDateTime} | Subject: ${m.subject || "(no subject)"} | ${m.bodyPreview}`)
      .join("\n");
  },
  "outlook-mail.read_message": async (c, p) => {
    const m = await graph(c, `/me/messages/${encodeURIComponent(p.id)}?$select=subject,from,toRecipients,receivedDateTime,body`, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    return clip(`From: ${m.from?.emailAddress?.address}\nDate: ${m.receivedDateTime}\nSubject: ${m.subject}\n\n${m.body?.content || ""}`);
  },
  "outlook-mail.send_email": async (c, p) => {
    await graph(c, "/me/sendMail", {
      json: { message: { subject: p.subject, body: { contentType: "Text", content: p.body }, toRecipients: [{ emailAddress: { address: p.to } }] }, saveToSentItems: true },
    });
    return `Email sent to ${p.to} with subject "${p.subject}".`;
  },
  "outlook-mail.create_draft": async (c, p) => {
    await graph(c, "/me/messages", { json: { subject: p.subject, body: { contentType: "Text", content: p.body }, toRecipients: [{ emailAddress: { address: p.to } }] } });
    return `Draft saved for ${p.to} with subject "${p.subject}".`;
  },

  // ---- Outlook calendar / OneDrive / Teams
  "outlook-calendar.list_events": async (c, p) => {
    const now = new Date();
    const url = new URL(`${GRAPH}/me/calendarView`);
    url.searchParams.set("startDateTime", isoOrThrow(p.timeMin, now));
    url.searchParams.set("endDateTime", isoOrThrow(p.timeMax, new Date(now.getTime() + 7 * 86400000)));
    url.searchParams.set("$top", "20");
    url.searchParams.set("$orderby", "start/dateTime");
    const data = await http(url.toString(), { token: token(c), headers: { Prefer: 'outlook.timezone="UTC"' } });
    if (!data.value?.length) return "No events in that range.";
    return data.value.map((e: any) => `${e.id} | ${e.start?.dateTime} → ${e.end?.dateTime} (UTC) | ${e.subject}${e.location?.displayName ? ` @ ${e.location.displayName}` : ""}`).join("\n");
  },
  "outlook-calendar.create_event": async (c, p) => {
    const tz = p.timeZone || "UTC";
    const attendees = String(p.attendees || "")
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean)
      .map((address) => ({ emailAddress: { address }, type: "required" }));
    const e = await graph(c, "/me/events", {
      json: { subject: p.summary, body: { contentType: "Text", content: p.description || "" }, start: { dateTime: p.start, timeZone: tz }, end: { dateTime: p.end, timeZone: tz }, attendees },
    });
    return `Event "${p.summary}" created. ${e.webLink || ""}`.trim();
  },
  "onedrive.search": async (c, p) => {
    const data = await graph(c, `/me/drive/root/search(q='${String(p.query).replace(/'/g, "''")}')?$top=10&$select=id,name,webUrl,lastModifiedDateTime,size`);
    if (!data.value?.length) return "No files found.";
    return data.value.map((f: any) => `id: ${f.id} | ${f.name} | ${f.size ?? "?"} bytes | modified ${f.lastModifiedDateTime} | ${f.webUrl}`).join("\n");
  },
  "ms-teams.list_chats": async (c) => {
    const data = await graph(c, "/me/chats?$top=15");
    if (!data.value?.length) return "No chats found.";
    return data.value.map((ch: any) => `id: ${ch.id} | ${ch.chatType} | ${ch.topic || "(no topic)"}`).join("\n");
  },
  "ms-teams.send_chat_message": async (c, p) => {
    await graph(c, `/chats/${encodeURIComponent(p.chatId)}/messages`, { json: { body: { content: p.text } } });
    return "Teams message sent.";
  },

  // ---- Notion
  "notion.search": async (c, p) => {
    const data = await http("https://api.notion.com/v1/search", { token: token(c), headers: notionHeaders, json: { query: p.query || "", page_size: 10 } });
    if (!data.results?.length) return "Nothing found (Notion only shows pages that were shared with this integration).";
    return data.results.map((r: any) => `id: ${r.id} | ${r.object} | ${notionTitle(r)} | ${r.url}`).join("\n");
  },
  "notion.get_page": async (c, p) => {
    const data = await http(`https://api.notion.com/v1/blocks/${encodeURIComponent(p.pageId)}/children?page_size=100`, { token: token(c), headers: notionHeaders });
    const text = (data.results || [])
      .map((b: any) => (b[b.type]?.rich_text || []).map((t: any) => t.plain_text).join(""))
      .filter(Boolean)
      .join("\n");
    return clip(text || "(the page has no text blocks)");
  },
  "notion.create_page": async (c, p) => {
    const lines = String(p.content || "").split("\n").filter((l) => l.trim()).slice(0, 90);
    const page = await http("https://api.notion.com/v1/pages", {
      token: token(c),
      headers: notionHeaders,
      json: {
        parent: { page_id: p.parentPageId },
        properties: { title: { title: [{ text: { content: p.title } }] } },
        children: lines.map((l) => ({ object: "block", type: "paragraph", paragraph: { rich_text: [{ type: "text", text: { content: l.slice(0, 1900) } }] } })),
      },
    });
    return `Created Notion page "${p.title}". ${page.url || ""}`.trim();
  },

  // ---- Slack
  "slack.list_channels": async (c) => {
    const data = await slack("conversations.list", c, { types: "public_channel", exclude_archived: true, limit: 100 });
    return (data.channels || []).map((ch: any) => `#${ch.name} | id: ${ch.id} | ${ch.num_members ?? "?"} members`).join("\n") || "No channels found.";
  },
  "slack.post_message": async (c, p) => {
    await slack("chat.postMessage", c, { channel: p.channel, text: p.text });
    return `Posted to Slack ${p.channel}.`;
  },
  "slack.read_history": async (c, p) => {
    const data = await slack("conversations.history", c, { channel: p.channel, limit: Math.min(Number(p.limit) || 10, 20) });
    return (data.messages || []).map((m: any) => `${new Date(Number(m.ts) * 1000).toISOString()} | ${m.user || m.bot_id || "?"}: ${m.text}`).join("\n") || "No messages.";
  },

  // ---- GitHub
  "github.list_repos": async (c) => {
    const repos = await gh(c, "/user/repos?sort=updated&per_page=10");
    return repos.map((r: any) => `${r.full_name}${r.private ? " (private)" : ""} ★${r.stargazers_count} — ${r.description || "no description"}`).join("\n") || "No repositories.";
  },
  "github.list_issues": async (c, p) => {
    const items = await gh(c, `/repos/${ghRepo(p.repo)}/issues?state=${p.state || "open"}&per_page=15`);
    return items.map((i: any) => `#${i.number}${i.pull_request ? " (PR)" : ""} [${i.state}] ${i.title} — ${i.html_url}`).join("\n") || "No issues.";
  },
  "github.create_issue": async (c, p) => {
    const issue = await gh(c, `/repos/${ghRepo(p.repo)}/issues`, { json: { title: p.title, body: p.body || "" } });
    return `Created issue #${issue.number}: ${issue.html_url}`;
  },
  "github.list_pull_requests": async (c, p) => {
    const items = await gh(c, `/repos/${ghRepo(p.repo)}/pulls?state=${p.state || "open"}&per_page=15`);
    return items.map((i: any) => `#${i.number} [${i.state}] ${i.title} by ${i.user?.login} — ${i.html_url}`).join("\n") || "No pull requests.";
  },
  "github.get_file": async (c, p) => {
    const path = String(p.path || "").replace(/^\/+/, "");
    const data = await gh(c, `/repos/${ghRepo(p.repo)}/contents/${path}${p.ref ? `?ref=${encodeURIComponent(p.ref)}` : ""}`);
    if (Array.isArray(data)) return data.map((f: any) => `${f.type === "dir" ? "📁" : "📄"} ${f.path}`).join("\n");
    return clip(Buffer.from(data.content || "", "base64").toString("utf8"), 8000);
  },

  // ---- Linear
  "linear.list_issues": async (c) => {
    const d = await linear(c, "{ issues(first: 15, orderBy: updatedAt) { nodes { identifier title url state { name } assignee { name } } } }");
    return d.issues.nodes.map((i: any) => `${i.identifier} [${i.state?.name}] ${i.title}${i.assignee ? ` (${i.assignee.name})` : ""} — ${i.url}`).join("\n") || "No issues.";
  },
  "linear.list_teams": async (c) => {
    const d = await linear(c, "{ teams { nodes { id key name } } }");
    return d.teams.nodes.map((t: any) => `${t.key} | ${t.name} | id: ${t.id}`).join("\n") || "No teams.";
  },
  "linear.create_issue": async (c, p) => {
    const d = await linear(c, "mutation($input: IssueCreateInput!){ issueCreate(input:$input){ success issue { identifier url } } }", {
      input: { teamId: p.teamId, title: p.title, description: p.description || "" },
    });
    return d.issueCreate?.success ? `Created ${d.issueCreate.issue.identifier}: ${d.issueCreate.issue.url}` : "Linear did not create the issue.";
  },

  // ---- CRM
  "hubspot.search_contacts": async (c, p) => {
    const data = await http("https://api.hubapi.com/crm/v3/objects/contacts/search", {
      token: token(c),
      json: { query: p.query, limit: 10, properties: ["firstname", "lastname", "email", "phone", "company"] },
    });
    if (!data.results?.length) return "No contacts found.";
    return data.results
      .map((r: any) => `id: ${r.id} | ${[r.properties.firstname, r.properties.lastname].filter(Boolean).join(" ") || "(no name)"} | ${r.properties.email || ""} | ${r.properties.company || ""} | ${r.properties.phone || ""}`)
      .join("\n");
  },
  "hubspot.create_contact": async (c, p) => {
    const created = await http("https://api.hubapi.com/crm/v3/objects/contacts", {
      token: token(c),
      json: { properties: { email: p.email, firstname: p.firstname, lastname: p.lastname, phone: p.phone, company: p.company } },
    });
    return `Created HubSpot contact ${p.email} (id ${created.id}).`;
  },
  "salesforce.query": async (c, p) => {
    const instance = c.meta?.instanceUrl;
    if (!instance) throw new Error("Salesforce instance URL is missing — reconnect Salesforce in Plugins.");
    const data = await http(`${instance}/services/data/v59.0/query?q=${encodeURIComponent(p.soql)}`, { token: token(c) });
    return clip(JSON.stringify(data.records?.map(({ attributes, ...rest }: any) => rest) ?? data, null, 2));
  },

  // ---- Search & data
  "web-search.search": async (_c, p) => webSearch(String(p.query)),
  "web-search.fetch_page": async (_c, p) => fetchPage(String(p.url)),
  "perplexity-search.search": async (c, p) => {
    if (!c.apiKey) throw new Error("Add your Perplexity API key in Plugins first.");
    const data = await http("https://api.perplexity.ai/chat/completions", { token: c.apiKey, json: { model: "sonar", messages: [{ role: "user", content: p.query }] } });
    const answer = data.choices?.[0]?.message?.content || "(empty answer)";
    const sources = (data.citations || []).map((u: string, i: number) => `[${i + 1}] ${u}`).join("\n");
    return clip(`${answer}${sources ? `\n\nSources:\n${sources}` : ""}`);
  },
  "wolfram.query": async (c, p) => {
    if (!c.apiKey) throw new Error("Add your Wolfram Alpha App ID in Plugins first.");
    try {
      const text = await http(`https://www.wolframalpha.com/api/v1/llm-api?input=${encodeURIComponent(p.input)}&appid=${encodeURIComponent(c.apiKey)}`);
      return clip(typeof text === "string" ? text : JSON.stringify(text));
    } catch {
      const text = await http(`https://api.wolframalpha.com/v1/result?appid=${encodeURIComponent(c.apiKey)}&i=${encodeURIComponent(p.input)}`);
      return String(text);
    }
  },
};

export async function executePluginAction(
  actionId: string,
  cred: string | PluginCredential | undefined,
  params: Record<string, any>
): Promise<string> {
  const handler = HANDLERS[actionId];
  if (!handler) throw new Error(`Unknown plugin action: ${actionId}`);

  const def = PLUGIN_ACTIONS.find((a) => a.id === actionId);
  const safeParams = params || {};
  for (const [key, description] of Object.entries(def?.params || {})) {
    const optional = /\(optional/i.test(description);
    if (!optional && (safeParams[key] === undefined || safeParams[key] === null || safeParams[key] === "")) {
      throw new Error(`Missing parameter "${key}" (${description}).`);
    }
  }

  const credential: PluginCredential = typeof cred === "string" ? { accessToken: cred } : cred || {};
  return handler(credential, safeParams);
}