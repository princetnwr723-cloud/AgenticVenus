// lib/mcpOrchestrator.ts
// Client-side glue for MCP: probing a URL to know what auth it needs,
// kicking off the OAuth "Continue to X" flow, and — once a server is
// connected — using the AI itself to decide whether a task needs one of
// its tools, then actually calling it.

import { auth } from "@/lib/firebase";
import { sendChatMessage } from "@/lib/chatClient";
import type { MCPServer } from "@/lib/mcp";
import type { MCPToolInfo } from "@/lib/mcpClient";

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

export type ProbeResult =
  | { authType: "none" }
  | { authType: "oauth" }
  | { authType: "apikey" };

export async function probeMcpServer(serverUrl: string): Promise<ProbeResult> {
  const res = await fetch("/api/mcp/probe", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ serverUrl }),
  });
  const data = await res.json();
  return { authType: data.authType || "apikey" };
}

/** Starts the real OAuth login for a server and returns the URL to send
 * the browser to — this is the "Continue to X" button's action. */
export async function startMcpOAuth(serverName: string, serverUrl: string): Promise<string> {
  const res = await fetch("/api/mcp/oauth/start", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ serverName, serverUrl }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to start OAuth login.");
  return data.authUrl as string;
}

export async function discoverMcpTools(serverUrl: string, apiKeyHeader?: string): Promise<MCPToolInfo[]> {
  const res = await fetch("/api/mcp/tools", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ serverUrl, apiKeyHeader }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to reach the MCP server.");
  return data.tools as MCPToolInfo[];
}

export async function callMcpTool(serverId: string, toolName: string, args: Record<string, any>): Promise<string> {
  const res = await fetch("/api/mcp/call", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ serverId, toolName, arguments: args }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "The MCP tool call failed.");
  return data.result as string;
}

export type PlannedToolCall = {
  serverId: string;
  toolName: string;
  arguments: Record<string, any>;
};

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

/** Asks the connected AI whether this task should trigger one of the
 * user's MCP tools, and with what arguments, based on each tool's real
 * input schema. Returns null if no tool fits. */
export async function decideMcpToolCall(
  providerId: string,
  apiKey: string,
  task: string,
  servers: MCPServer[],
  model?: string
): Promise<PlannedToolCall | null> {
  const withTools = servers.filter((s) => s.tools && s.tools.length > 0);
  if (withTools.length === 0) return null;

  const catalog = withTools
    .flatMap((s) =>
      (s.tools || []).map(
        (t) =>
          `serverId: ${s.id} | server: ${s.name} | tool: ${t.name} | description: ${t.description || "(none)"} | inputSchema: ${JSON.stringify(
            t.inputSchema || {}
          )}`
      )
    )
    .join("\n");

  const prompt = `You have access to these MCP tools:\n${catalog}\n\nTask: "${task}"\n\nDecide if one of these tools should be called to help with this task. Reply with ONLY raw JSON, no other text:\n{"useTool": boolean, "serverId": "matching serverId or null", "toolName": "matching tool name or null", "arguments": {"...": "arguments matching that tool's inputSchema, inferred from the task"}}\n\nIf no tool fits, reply {"useTool": false, "serverId": null, "toolName": null, "arguments": {}}.`;

  try {
    const { text } = await sendChatMessage({
      providerId,
      apiKey,
      messages: [{ role: "user", content: prompt }],
      model,
    });
    const parsed = JSON.parse(extractJson(text));
    if (!parsed?.useTool || !parsed.serverId || !parsed.toolName) return null;

    const server = servers.find((s) => s.id === parsed.serverId);
    if (!server) return null;

    return { serverId: server.id, toolName: parsed.toolName, arguments: parsed.arguments || {} };
  } catch {
    return null;
  }
}