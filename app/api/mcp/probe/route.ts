// app/api/mcp/probe/route.ts
// Called the moment a user types an MCP server URL, before anything is
// saved. Figures out whether it needs no auth, a pasted API key, or a
// real OAuth login — so the UI can show the right next step (a
// "Continue to X" button for OAuth, exactly like Claude.ai does).

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { probeMcpAuth } from "@/lib/mcpOAuth";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    await adminAuth().verifyIdToken(idToken);

    const { serverUrl } = await req.json();
    if (!serverUrl) return NextResponse.json({ error: "serverUrl is required." }, { status: 400 });

    const result = await probeMcpAuth(serverUrl);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/mcp/probe]", err);
    return NextResponse.json({ ok: true, authType: "apikey" });
  }
}