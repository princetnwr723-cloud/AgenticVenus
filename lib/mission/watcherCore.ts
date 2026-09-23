// lib/mission/watcherCore.ts
// Looks at recent Gmail replies, asks the model which ones sound like a
// genuine positive reply to the outreach, and books a calendar event for
// each one. Shared between the client's immediate check and the server-side
// cron tick (app/api/missions/tick), via a small injected `runPlugin`
// function so this file has no idea whether it's running in the browser or
// on the server.

import { parseFirstJson } from "@/lib/agentJson";
import { sendChatMessage } from "@/lib/chatClient";

export type RunPlugin = (toolId: string, actionId: string, params: Record<string, any>) => Promise<string>;

export type WatchResult = { checked: number; booked: number; summary: string };

export async function runOutreachWatch(
  providerId: string,
  apiKey: string,
  model: string | undefined,
  runPlugin: RunPlugin,
  outreachContext: string
): Promise<WatchResult> {
  let listing = "";
  try {
    listing = await runPlugin("gmail", "gmail.list_messages", { query: "is:unread newer_than:14d" });
  } catch (err) {
    return { checked: 0, booked: 0, summary: `Couldn't check Gmail: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!listing || /^no messages/i.test(listing.trim())) {
    return { checked: 0, booked: 0, summary: "No new replies yet." };
  }

  const prompt = `Outreach context (what was sent and to whom):\n${outreachContext.slice(0, 3000)}\n\nRecent unread Gmail messages:\n${listing.slice(0, 6000)}\n\nWhich of these look like a genuine reply to that outreach where the person shows real interest (not spam, not an auto-reply, not unrelated)? For each one, propose a short meeting title and an ISO start time within the next 5 business days at a reasonable hour. Reply with ONLY raw JSON: {"interested":[{"messageId":"...","from":"...","meetingTitle":"...","start":"2026-09-25T15:00:00","end":"2026-09-25T15:30:00"}]}`;
  const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
  const parsed = parseFirstJson<{ interested?: any[] }>(text);
  const interested = Array.isArray(parsed?.interested) ? parsed!.interested! : [];

  let booked = 0;
  const lines: string[] = [];
  for (const lead of interested) {
    try {
      await runPlugin("google-calendar", "google-calendar.create_event", {
        summary: lead.meetingTitle || `Call with ${lead.from || "a lead"}`,
        start: lead.start,
        end: lead.end,
        description: `Booked automatically after a reply from ${lead.from || "unknown"}.`,
      });
      booked++;
      lines.push(`Booked "${lead.meetingTitle}" with ${lead.from}.`);
    } catch (err) {
      lines.push(`Found interest from ${lead.from} but couldn't book it: ${err instanceof Error ? err.message : String(err)}.`);
    }
  }

  const summary = interested.length
    ? `${interested.length} promising repl${interested.length === 1 ? "y" : "ies"} found, ${booked} meeting(s) booked.\n${lines.join("\n")}`
    : "Checked recent replies — nothing that looked like genuine interest yet.";
  return { checked: interested.length, booked, summary };
}