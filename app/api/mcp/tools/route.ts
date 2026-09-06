// app/api/mcp/tools/route.ts
// Two jobs: (1) discover tools for a server that doesn't need auth or
// already has an API key (serverUrl + optional apiKeyHeader passed
// directly — used right after "Add" for simple servers), and (2)
// refresh tools for an already-saved server by id (resolves its stored
// auth, including refreshing an OAuth token if it's expired).

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { mcpListTools } from "@/lib/mcpClient";
import { refreshAccessToken } from "@/lib/mcpOAuth";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const body = await req.json();

    if (body.serverId) {
      const db = adminDb();
      const ref = db.collection("users").doc(decoded.uid).collection("mcpServers").doc(body.serverId);
      const snap = await ref.get();
      if (!snap.exists) return NextResponse.json({ error: "Server not found." }, { status: 404 });
      const server = snap.data()!;

      const resolvedAuth = await resolveAuthHeader(ref, server);
      const tools = await mcpListTools(server.url, resolvedAuth);
      await ref.update({ tools });
      return NextResponse.json({ ok: true, tools });
    }

    const { serverUrl, apiKeyHeader } = body;
    if (!serverUrl) return NextResponse.json({ error: "serverUrl is required." }, { status: 400 });
    const tools = await mcpListTools(serverUrl, apiKeyHeader || undefined);
    return NextResponse.json({ ok: true, tools });
  } catch (err) {
    console.error("[api/mcp/tools]", err);
    const message = err instanceof Error ? err.message : "Failed to reach the MCP server.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function resolveAuthHeader(ref: FirebaseFirestore.DocumentReference, server: any): Promise<string | undefined> {
  if (server.authType === "apikey") return server.apiKeyHeader;
  if (server.authType === "oauth" && server.oauth) {
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
    return `Bearer ${accessToken}`;
  }
  return undefined;
}