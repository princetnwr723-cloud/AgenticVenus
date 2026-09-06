// app/api/plugins/oauth/start/route.ts
// The real "Continue with Gmail" button's action — builds a login URL
// using AgenticVenus's own registered OAuth app for that provider (see
// lib/oauthProviders.ts), not a generic discovery flow.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { getOAuthProvider, isEnvConfigured } from "@/lib/oauthProviders";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { toolId } = await req.json();
    const config = getOAuthProvider(toolId);
    if (!config) return NextResponse.json({ error: "No OAuth app configured for this tool yet." }, { status: 400 });

    if (!isEnvConfigured(config)) {
      return NextResponse.json(
        {
          error: `${config.displayName} needs ${config.clientIdEnv} and ${config.clientSecretEnv} set as environment variables before this can work.`,
        },
        { status: 400 }
      );
    }

    const redirectUri = `${req.nextUrl.origin}/api/plugins/oauth/callback`;
    const state = crypto.randomUUID();

    await adminDb().collection("pluginOAuthSessions").doc(state).set({
      uid: decoded.uid,
      toolId,
      redirectUri,
      createdAt: Date.now(),
    });

    const authUrl = new URL(config.authorizationUrl);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("client_id", process.env[config.clientIdEnv]!);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", config.scopes.join(" "));
    authUrl.searchParams.set("state", state);
    for (const [k, v] of Object.entries(config.extraAuthParams || {})) {
      authUrl.searchParams.set(k, v);
    }

    return NextResponse.json({ ok: true, authUrl: authUrl.toString() });
  } catch (err) {
    console.error("[api/plugins/oauth/start]", err);
    const message = err instanceof Error ? err.message : "Failed to start login.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}