// app/api/mcp/oauth/callback/route.ts
// The service (Gmail, Creatify, etc.) redirects the user's browser back
// here after they log in and approve access. Exchanges the code for real
// tokens, saves the MCP server as connected, and sends the user back to
// their workspace.

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { exchangeCodeForTokens } from "@/lib/mcpOAuth";
import { mcpListTools } from "@/lib/mcpClient";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const origin = req.nextUrl.origin;

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/home?mcpError=Missing+code+or+state`);
  }

  try {
    const db = adminDb();
    const sessionRef = db.collection("mcpOAuthSessions").doc(state);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      return NextResponse.redirect(`${origin}/home?mcpError=OAuth+session+expired,+please+try+again`);
    }
    const session = sessionSnap.data()!;

    const tokens = await exchangeCodeForTokens(
      session.tokenEndpoint,
      code,
      session.codeVerifier,
      session.clientId,
      session.redirectUri
    );

    const authHeader = `Bearer ${tokens.accessToken}`;
    let tools: any[] = [];
    try {
      tools = await mcpListTools(session.serverUrl, authHeader);
    } catch (err) {
      console.error("[mcp oauth callback] tool discovery failed:", err);
    }

    await db.collection("users").doc(session.uid).collection("mcpServers").add({
      name: session.serverName,
      url: session.serverUrl,
      authType: "oauth",
      oauth: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken || null,
        expiresAt: tokens.expiresAt,
        tokenEndpoint: session.tokenEndpoint,
        clientId: session.clientId,
        redirectUri: session.redirectUri,
      },
      tools,
      createdAt: new Date(),
    });

    await sessionRef.delete();

    return NextResponse.redirect(`${origin}/home?mcpConnected=${encodeURIComponent(session.serverName)}`);
  } catch (err) {
    console.error("[api/mcp/oauth/callback]", err);
    const message = err instanceof Error ? err.message : "OAuth exchange failed.";
    return NextResponse.redirect(`${origin}/home?mcpError=${encodeURIComponent(message)}`);
  }
}