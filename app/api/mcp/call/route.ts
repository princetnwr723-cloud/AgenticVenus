// app/api/mcp/call/route.ts
// This is what makes MCP tools actually DO something — the agent decides
// a tool should run (see lib/mcpOrchestrator.ts), and this route makes
// the real call to the MCP server and returns its result.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { mcpCallTool } from "@/lib/mcpClient";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    await adminAuth().verifyIdToken(idToken);

    const { serverUrl, toolName, arguments: args, authHeader } = await req.json();
    if (!serverUrl || !toolName) {
      return NextResponse.json({ error: "serverUrl and toolName are required." }, { status: 400 });
    }

    const result = await mcpCallTool(serverUrl, toolName, args || {}, authHeader || undefined);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/mcp/call]", err);
    const message = err instanceof Error ? err.message : "Failed to call the MCP tool.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}