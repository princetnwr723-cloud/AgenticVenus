// lib/mcpClient.ts
// A real client for the MCP (Model Context Protocol) "Streamable HTTP"
// transport — this is what actually lets AgenticVenus call tools on a
// remote MCP server like Creatify's, instead of just remembering its URL.
// Server-side only (avoids browser CORS issues and keeps any auth header
// off the client) — used from the /api/mcp/* routes.

type JsonRpcResponse = {
  jsonrpc: string;
  id?: number | string;
  result?: any;
  error?: { code: number; message: string };
};

export type MCPToolInfo = {
  name: string;
  description?: string;
  inputSchema?: any;
};

async function mcpRequest(
  serverUrl: string,
  method: string,
  params: any,
  sessionId: string | undefined,
  authHeader: string | undefined,
  isNotification = false
): Promise<{ result?: any; sessionId?: string }> {
  const body: any = { jsonrpc: "2.0", method, params };
  if (!isNotification) body.id = Date.now();

  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (authHeader) headers["authorization"] = authHeader;

  const res = await fetch(serverUrl, { method: "POST", headers, body: JSON.stringify(body) });
  const returnedSessionId = res.headers.get("mcp-session-id") || sessionId;

  if (isNotification) {
    return { sessionId: returnedSessionId };
  }

  const contentType = res.headers.get("content-type") || "";
  let payload: JsonRpcResponse | null = null;

  if (contentType.includes("text/event-stream")) {
    const text = await res.text();
    for (const line of text.split("\n")) {
      if (!line.startsWith("data:")) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed.id !== undefined) {
          payload = parsed;
          break;
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  } else {
    payload = await res.json().catch(() => null);
  }

  if (!res.ok) {
    throw new Error(payload?.error?.message || `MCP server returned ${res.status}`);
  }
  if (payload?.error) {
    throw new Error(payload.error.message);
  }

  return { result: payload?.result, sessionId: returnedSessionId };
}

async function handshake(serverUrl: string, authHeader?: string): Promise<string | undefined> {
  const init = await mcpRequest(
    serverUrl,
    "initialize",
    {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "AgenticVenus", version: "1.0.0" },
    },
    undefined,
    authHeader
  );
  await mcpRequest(serverUrl, "notifications/initialized", {}, init.sessionId, authHeader, true).catch(
    () => null
  );
  return init.sessionId;
}

export async function mcpListTools(serverUrl: string, authHeader?: string): Promise<MCPToolInfo[]> {
  const sessionId = await handshake(serverUrl, authHeader);
  const list = await mcpRequest(serverUrl, "tools/list", {}, sessionId, authHeader);
  return list.result?.tools ?? [];
}

export async function mcpCallTool(
  serverUrl: string,
  toolName: string,
  args: Record<string, any>,
  authHeader?: string
): Promise<string> {
  const sessionId = await handshake(serverUrl, authHeader);
  const result = await mcpRequest(
    serverUrl,
    "tools/call",
    { name: toolName, arguments: args },
    sessionId,
    authHeader
  );
  const content = result.result?.content;
  if (Array.isArray(content)) {
    return content.map((c: any) => c.text || JSON.stringify(c)).join("\n");
  }
  return JSON.stringify(result.result ?? {});
}