// lib/pluginOrchestrator.ts
// Client-side glue: starts the real "Continue with X" login for a
// plugin, and — once connected — uses the AI itself to decide whether a
// task should trigger a real plugin action (send an email, etc.), then
// calls it for real.

import { auth } from "@/lib/firebase";
import { sendChatMessage } from "@/lib/chatClient";
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

export async function decidePluginAction(
  providerId: string,
  apiKey: string,
  task: string,
  connectedToolIds: string[],
  model?: string
): Promise<PlannedPluginAction | null> {
  const available = PLUGIN_ACTIONS.filter((a) => connectedToolIds.includes(a.toolId));
  if (available.length === 0) return null;

  const catalog = available
    .map((a) => `actionId: ${a.id} | name: ${a.name} | description: ${a.description} | params: ${JSON.stringify(a.params)}`)
    .join("\n");

  const prompt = `You have access to these real connected actions:\n${catalog}\n\nTask: "${task}"\n\nDecide if one of these actions should run for real to help with this task. Reply with ONLY raw JSON:\n{"useAction": boolean, "actionId": "matching id or null", "params": {"...": "values inferred from the task"}}\n\nIf none fit, reply {"useAction": false, "actionId": null, "params": {}}. Be careful: only pick an action the user actually asked for (e.g. don't send an email unless they clearly asked you to send one — creating a draft is safer if they just asked you to "write" or "draft" something).`;

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