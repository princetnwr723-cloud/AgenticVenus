// app/api/mcp/call/route.ts
// Actually calls a tool on a saved MCP server. Resolves that server's
// stored auth (API key or OAuth, refreshing the OAuth token if needed)
// server-side, so the client never has to handle tokens directly.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { mcpCallTool } from "@/lib/mcpClient";
import { refreshAccessToken } from "@/lib/mcpOAuth";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { serverId, toolName, arguments: args } = await req.json();
    if (!serverId || !toolName) {
      return NextResponse.json({ error: "serverId and toolName are required." }, { status: 400 });
    }

    const db = adminDb();
    const ref = db.collection("users").doc(decoded.uid).collection("mcpServers").doc(serverId);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Server not found." }, { status: 404 });
    const server = snap.data()!;

    let resolvedAuth: string | undefined;
    if (server.authType === "apikey") {
      resolvedAuth = server.apiKeyHeader;
    } else if (server.authType === "oauth" && server.oauth) {
      let { accessToken, refreshToken, expiresAt, tokenEndpoint, clientId } = server.oauth;
      if (Date.now() > expiresAt - 60_000 && refreshToken) {
        const refreshed = await refreshAccessToken(tokenEndpoint, refreshToken, clientId);
        accessToken = refreshed.accessToken;
        await ref.update({
          "oauth.accessToken": refreshed.accessToken,
          "oauth.refreshToken": refreshed.refreshToken || refreshToken,
          "oauth.expiresAt": refreshed.expiresAt,
        });
      }
      resolvedAuth = `Bearer ${accessToken}`;
    }

    const result = await mcpCallTool(server.url, toolName, args || {}, resolvedAuth);
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/mcp/call]", err);
    const message = err instanceof Error ? err.message : "Failed to call the MCP tool.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}