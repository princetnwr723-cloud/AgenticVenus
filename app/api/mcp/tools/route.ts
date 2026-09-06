// app/api/mcp/tools/route.ts
// Called when a user adds (or refreshes) an MCP server. Actually connects
// to it and asks what tools it has — this is what confirms the server is
// real and reachable, instead of just saving a URL and hoping.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { mcpListTools } from "@/lib/mcpClient";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    await adminAuth().verifyIdToken(idToken);

    const { serverUrl, authHeader } = await req.json();
    if (!serverUrl) {
      return NextResponse.json({ error: "serverUrl is required." }, { status: 400 });
    }

    const tools = await mcpListTools(serverUrl, authHeader || undefined);
    return NextResponse.json({ ok: true, tools });
  } catch (err) {
    console.error("[api/mcp/tools]", err);
    const message = err instanceof Error ? err.message : "Failed to reach the MCP server.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}