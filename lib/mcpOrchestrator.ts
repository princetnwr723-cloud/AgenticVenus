// lib/mcpOrchestrator.ts
// Client-side glue: calls our /api/mcp/* routes (which speak the real MCP
// protocol server-side), and uses the connected AI itself to decide
// whether a task should trigger one of the MCP tools the user has set up
// — and with what arguments — before answering.

import { auth } from "@/lib/firebase";
import { sendChatMessage } from "@/lib/chatClient";
import type { MCPServer } from "@/lib/mcp";
import type { MCPToolInfo } from "@/lib/mcpClient";

async function authHeader() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { authorization: `Bearer ${idToken}` };
}

export async function discoverMcpTools(serverUrl: string, serverAuthHeader?: string): Promise<MCPToolInfo[]> {
  const res = await fetch("/api/mcp/tools", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ serverUrl, authHeader: serverAuthHeader }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to reach the MCP server.");
  return data.tools as MCPToolInfo[];
}

export async function callMcpTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, any>,
  serverAuthHeader?: string
): Promise<string> {
  const res = await fetch("/api/mcp/call", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ serverUrl, toolName, arguments: args, authHeader: serverAuthHeader }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "The MCP tool call failed.");
  return data.result as string;
}

export type PlannedToolCall = {
  serverId: string;
  serverUrl: string;
  serverAuthHeader?: string;
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
          `serverId: ${s.id} | tool: ${t.name} | description: ${t.description || "(none)"} | inputSchema: ${JSON.stringify(
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

    return {
      serverId: server.id,
      serverUrl: server.url,
      serverAuthHeader: server.authHeader,
      toolName: parsed.toolName,
      arguments: parsed.arguments || {},
    };
  } catch {
    return null;
  }
}