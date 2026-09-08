// lib/toolDetect.ts
// Before answering, checks whether the CONVERSATION (not just the latest
// message) needs an external tool. Using the full recent history here is
// what fixes multi-turn commands like "draft it" → "now send it" — the
// old version only looked at the single latest message, so a follow-up
// like "send it" with no other detail couldn't be matched to anything.

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { PLUGIN_TOOLS } from "@/lib/plugins";

export type ToolNeed = {
  toolId: string | null;
  toolName: string;
  known: boolean;
  connected: boolean;
};

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

function transcript(messages: ChatMessage[], turns = 8): string {
  return messages
    .slice(-turns)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");
}

export async function detectToolNeed(
  providerId: string,
  apiKey: string,
  messages: ChatMessage[],
  connectedToolIds: string[],
  model?: string
): Promise<ToolNeed | null> {
  const catalog = PLUGIN_TOOLS.map((t) => `${t.id}: ${t.name} — ${t.description}`).join("\n");

  const prompt = `Decide if the LATEST message in this conversation would require using an external tool/account (like sending an email, checking a calendar, posting a message, looking at a repo, etc.) rather than just knowledge or conversation. Use the full conversation for context — a short follow-up like "send it" or "now do it" refers back to what was discussed earlier.

Conversation so far:
${transcript(messages)}

Known tool catalog (match against these ids if it fits one):
${catalog}

Reply with ONLY raw JSON, no other text:
{"needsTool": boolean, "toolId": "matching id from the catalog, or null if none fits", "toolName": "human name of the tool needed (even if not in the catalog)"}

If no external tool is needed, reply {"needsTool": false, "toolId": null, "toolName": ""}.`;

  try {
    const { text } = await sendChatMessage({
      providerId,
      apiKey,
      messages: [{ role: "user", content: prompt }],
      model,
    });
    const parsed = JSON.parse(extractJson(text));
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