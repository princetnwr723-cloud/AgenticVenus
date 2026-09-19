import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getOAuthProvider } from "@/lib/oauthProviders";
import { encryptSecret } from "@/lib/secretsVault";

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const origin = req.nextUrl.origin;

  if (!code || !state) {
    return NextResponse.redirect(`${origin}/home?pluginError=Missing+code+or+state`);
  }

  try {
    const db = adminDb();
    const sessionRef = db.collection("pluginOAuthSessions").doc(state);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      return NextResponse.redirect(`${origin}/home?pluginError=Login+session+expired,+please+try+again`);
    }
    const session = sessionSnap.data()!;
    const config = getOAuthProvider(session.toolId);
    if (!config) {
      return NextResponse.redirect(`${origin}/home?pluginError=Unknown+plugin`);
    }

    const tokenRes = await fetch(config.tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: session.redirectUri,
        client_id: process.env[config.clientIdEnv]!,
        client_secret: process.env[config.clientSecretEnv]!,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error) {
      throw new Error(tokenData.error_description || tokenData.error || "Token exchange failed.");
    }

    await db.collection("users").doc(session.uid).collection("pluginConnections").doc(session.toolId).set({
      accessToken_enc: encryptSecret(tokenData.access_token),
      refreshToken_enc: tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : null,
      expiresAt: Date.now() + (tokenData.expires_in ? tokenData.expires_in * 1000 : 55 * 60 * 1000),
      connectedAt: new Date().toISOString(),
    });

    await sessionRef.delete();
    return NextResponse.redirect(`${origin}/home?pluginConnected=${encodeURIComponent(config.displayName)}`);
  } catch (err) {
    console.error("[api/plugins/oauth/callback]", err);
    const message = err instanceof Error ? err.message : "Login failed.";
    return NextResponse.redirect(`${origin}/home?pluginError=${encodeURIComponent(message)}`);
  }
}