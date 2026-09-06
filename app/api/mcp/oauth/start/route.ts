// app/api/mcp/oauth/start/route.ts
// Called when the user clicks "Continue to X" for an MCP server that
// needs OAuth. Registers AgenticVenus as a client with that server's
// auth server (if it supports it), builds a PKCE-protected login URL,
// stashes what the callback will need to finish the exchange, and hands
// back the URL to redirect the browser to.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { generatePkce, probeMcpAuth, registerOAuthClient } from "@/lib/mcpOAuth";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { serverName, serverUrl } = await req.json();
    if (!serverName || !serverUrl) {
      return NextResponse.json({ error: "serverName and serverUrl are required." }, { status: 400 });
    }

    const discovery = await probeMcpAuth(serverUrl);
    if (discovery.authType !== "oauth") {
      return NextResponse.json({ error: "This server doesn't advertise an OAuth login." }, { status: 400 });
    }

    const redirectUri = `${req.nextUrl.origin}/api/mcp/oauth/callback`;
    const clientId = discovery.registrationEndpoint
      ? await registerOAuthClient(discovery.registrationEndpoint, redirectUri)
      : undefined;

    if (!clientId) {
      return NextResponse.json(
        { error: "This server needs a pre-registered OAuth client, which isn't supported yet — use an API key instead if it offers one." },
        { status: 400 }
      );
    }

    const { verifier, challenge } = generatePkce();
    const state = crypto.randomUUID();

    await adminDb().collection("mcpOAuthSessions").doc(state).set({
      uid: decoded.uid,
      serverName,
      serverUrl,
      codeVerifier: verifier,
      tokenEndpoint: discovery.tokenEndpoint,
      clientId,
      redirectUri,
      createdAt: Date.now(),
    });

    const authUrl = new URL(discovery.authorizationEndpoint);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("state", state);
    if (discovery.scope) authUrl.searchParams.set("scope", discovery.scope);

    return NextResponse.json({ ok: true, authUrl: authUrl.toString() });
  } catch (err) {
    console.error("[api/mcp/oauth/start]", err);
    const message = err instanceof Error ? err.message : "Failed to start the OAuth flow.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}