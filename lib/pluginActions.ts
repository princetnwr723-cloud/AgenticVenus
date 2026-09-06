// lib/pluginActions.ts
// The real work each connected plugin can do. Server-side only (needs
// the user's access token, never exposed to the browser). Add a new
// action here + register it in PLUGIN_ACTIONS to extend what the agent
// can actually do with a connected plugin.

export type PluginActionDef = {
  id: string;
  toolId: string;
  name: string;
  description: string;
  params: Record<string, string>;
};

export const PLUGIN_ACTIONS: PluginActionDef[] = [
  {
    id: "gmail.send_email",
    toolId: "gmail",
    name: "Send Gmail",
    description: "Send an email right now from the user's Gmail account.",
    params: { to: "recipient email address", subject: "email subject", body: "plain text email body" },
  },
  {
    id: "gmail.create_draft",
    toolId: "gmail",
    name: "Create Gmail draft",
    description: "Create a draft email in Gmail without sending it.",
    params: { to: "recipient email address", subject: "email subject", body: "plain text email body" },
  },
  {
    id: "gmail.list_messages",
    toolId: "gmail",
    name: "Search Gmail",
    description: "Search or list recent Gmail messages.",
    params: { query: "Gmail search query, e.g. 'is:unread' or 'from:someone@example.com' (optional)" },
  },
];

function buildRawMessage(to: string, subject: string, body: string): string {
  const message = [`To: ${to}`, `Subject: ${subject}`, "Content-Type: text/plain; charset=utf-8", "", body].join(
    "\r\n"
  );
  return Buffer.from(message)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function gmailSendEmail(
  accessToken: string,
  { to, subject, body }: { to: string; subject: string; body: string }
): Promise<string> {
  const raw = buildRawMessage(to, subject, body);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ raw }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Failed to send email.");
  return `Email sent to ${to} with subject "${subject}".`;
}

async function gmailCreateDraft(
  accessToken: string,
  { to, subject, body }: { to: string; subject: string; body: string }
): Promise<string> {
  const raw = buildRawMessage(to, subject, body);
  const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { raw } }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Failed to create draft.");
  return `Draft created for ${to} with subject "${subject}".`;
}

async function gmailListMessages(accessToken: string, { query }: { query?: string }): Promise<string> {
  const url = new URL("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  if (query) url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "5");
  const res = await fetch(url.toString(), { headers: { authorization: `Bearer ${accessToken}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Failed to list messages.");
  if (!data.messages?.length) return "No messages found.";

  const details = await Promise.all(
    data.messages.slice(0, 5).map((m: any) =>
      fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From`,
        { headers: { authorization: `Bearer ${accessToken}` } }
      ).then((r) => r.json())
    )
  );

  return details
    .map((d: any) => {
      const headers = d.payload?.headers || [];
      const subject = headers.find((h: any) => h.name === "Subject")?.value || "(no subject)";
      const from = headers.find((h: any) => h.name === "From")?.value || "(unknown sender)";
      return `From: ${from} | Subject: ${subject} | Snippet: ${d.snippet}`;
    })
    .join("\n");
}

export async function executePluginAction(
  actionId: string,
  accessToken: string,
  params: Record<string, any>
): Promise<string> {
  switch (actionId) {
    case "gmail.send_email":
      return await gmailSendEmail(accessToken, params as any);
    case "gmail.create_draft":
      return await gmailCreateDraft(accessToken, params as any);
    case "gmail.list_messages":
      return await gmailListMessages(accessToken, params as any);
    default:
      throw new Error(`Unknown plugin action: ${actionId}`);
  }
}