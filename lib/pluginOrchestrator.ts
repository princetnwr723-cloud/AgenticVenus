// lib/pluginOrchestrator.ts
// Client-side glue: starts the real "Continue with X" login for a plugin, and —
// once connected — uses the AI itself to decide whether the CONVERSATION (not
// just the latest message) needs a real plugin action, then calls it.
//
// Using full context here is what makes follow-ups like "now send it" work, and
// the tool-result feedback loop in app/home/page.tsx lets the agent chain
// actions (list channels → post message, search Drive → read file, …).

import { auth } from "@/lib/firebase";
import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { parseFirstJson } from "@/lib/agentJson";
import { PLUGIN_ACTIONS } from "@/lib/pluginCatalog";

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

export async function startPluginOAuth(toolId: string): Promise<string> {
  const res = await fetch("/api/plugins/oauth/start", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ toolId }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to start login.");
  return data.authUrl as string;
}

export async function callPluginAction(
  toolId: string,
  actionId: string,
  params: Record<string, any>
): Promise<string> {
  const res = await fetch("/api/plugins/call", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ toolId, actionId, params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "The action failed.");
  return data.result as string;
}

export type PlannedPluginAction = {
  toolId: string;
  actionId: string;
  actionName: string;
  params: Record<string, any>;
};

function transcript(messages: ChatMessage[], turns = 10): string {
  return messages
    .slice(-turns)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, m.content.startsWith("[REAL TOOL") ? 4000 : 1800)}`)
    .join("\n");
}

export async function decidePluginAction(
  providerId: string,
  apiKey: string,
  messages: ChatMessage[],
  connectedToolIds: string[],
  model?: string
): Promise<PlannedPluginAction | null> {
  const available = PLUGIN_ACTIONS.filter((a) => connectedToolIds.includes(a.toolId));
  if (available.length === 0) return null;

  const catalog = available
    .map(
      (a) =>
        `- ${a.id} [${a.write ? "WRITE" : "read"}] ${a.description} params: ${JSON.stringify(a.params)}`
    )
    .join("\n");

  let timeZone = "UTC";
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {}
  const now = new Date();

  const prompt = `You can call these REAL connected actions:
${catalog}

Current date/time: ${now.toISOString()} (user's time zone: ${timeZone}). Resolve words like "tomorrow" or "next Monday" into concrete ISO date-times yourself.

Conversation so far (a short follow-up such as "send it" or "yes do it" refers to details discussed earlier; lines starting with [REAL TOOL RESULT] are results of actions already run):
${transcript(messages)}

Decide whether ONE of these actions should run right now, based on the latest USER request plus any [REAL TOOL RESULT] lines.
Rules:
- Only use an action the user actually asked for. Never repeat an action the transcript shows already succeeded.
- WRITE actions (send / create / post) only when the user clearly asked to do that. If they only asked to "write" or "draft" something, prefer a draft action, or none.
- If you need an id you don't have (a channel id, message id, file id, team id, chat id), run the matching list/search action first.
- Once the tool results already contain everything needed to answer, choose no action.
Reply with ONLY raw JSON:
{"useAction": boolean, "actionId": "id from the list or null", "params": {"param": "value inferred from the whole conversation"}}`;

  try {
    const { text } = await sendChatMessage({
      providerId,
      apiKey,
      messages: [{ role: "user", content: prompt }],
      model,
    });
    const parsed = parseFirstJson<{ useAction?: boolean; actionId?: string; params?: Record<string, any> }>(text);
    if (!parsed?.useAction || !parsed.actionId) return null;

    const action = available.find((a) => a.id === parsed.actionId);
    if (!action) return null;

    return { toolId: action.toolId, actionId: action.id, actionName: action.name, params: parsed.params || {} };
  } catch {
    return null;
  }
}