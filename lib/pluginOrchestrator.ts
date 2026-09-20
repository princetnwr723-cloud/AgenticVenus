// lib/pluginOrchestrator.ts
// Client-side glue: starts the real "Continue with X" login for a
// plugin, and — once connected — uses the AI itself to decide whether
// the CONVERSATION (not just the latest message) needs a real plugin
// action, then calls it. Using full context here is what fixes
// follow-ups like "now send it" after a draft was discussed earlier.

import { auth } from "@/lib/firebase";
import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { PLUGIN_ACTIONS } from "@/lib/pluginActions";

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
    .map((a) => `actionId: ${a.id} | name: ${a.name} | description: ${a.description} | params: ${JSON.stringify(a.params)}`)
    .join("\n");

  const prompt = `You have access to these real connected actions:\n${catalog}\n\nConversation so far (use this for context — a short follow-up like "send it" or "yes do it" refers back to details discussed earlier):\n${transcript(messages)}\n\nDecide if one of these actions should run for real right now, based on the latest USER request plus any REAL TOOL RESULTS already recorded. Reply with ONLY raw JSON:\n{"useAction": boolean, "actionId": "matching id or null", "params": {"...": "values inferred from the whole conversation, not just the last line"}}\n\nIf none fit, reply {"useAction": false, "actionId": null, "params": {}}. Only pick an action the user actually asked for right now, and do not repeat an action that the transcript already shows succeeded — e.g. don't send an email unless they clearly asked to send (creating a draft is safer if they only asked you to "write" or "draft" something).`;

  try {
    const { text } = await sendChatMessage({
      providerId,
      apiKey,
      messages: [{ role: "user", content: prompt }],
      model,
    });
    const parsed = JSON.parse(extractJson(text));
    if (!parsed?.useAction || !parsed.actionId) return null;

    const action = available.find((a) => a.id === parsed.actionId);
    if (!action) return null;

    return { toolId: action.toolId, actionId: action.id, actionName: action.name, params: parsed.params || {} };
  } catch {
    return null;
  }
}