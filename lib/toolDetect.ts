// lib/toolDetect.ts
// Before answering, checks whether the user's message needs a tool the
// agent doesn't have direct access to (e.g. "send an email" needs
// Gmail). If it matches a known plugin, the agent knows whether that
// plugin is connected. If it doesn't match anything in the plugin
// catalog, the agent should point the user to MCP Tools instead.

import { sendChatMessage } from "@/lib/chatClient";
import { PLUGIN_TOOLS } from "@/lib/plugins";

export type ToolNeed = {
  toolId: string | null;
  toolName: string;
  known: boolean; // true if it matches something in our plugin catalog
  connected: boolean;
};

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export async function detectToolNeed(
  providerId: string,
  apiKey: string,
  message: string,
  connectedToolIds: string[],
  model?: string
): Promise<ToolNeed | null> {
  const catalog = PLUGIN_TOOLS.map((t) => `${t.id}: ${t.name} — ${t.description}`).join("\n");

  const prompt = `Decide if answering this message well would require using an external tool/account (like sending an email, checking a calendar, posting a message, looking at a repo, etc.) rather than just knowledge or conversation.

Message: "${message}"

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