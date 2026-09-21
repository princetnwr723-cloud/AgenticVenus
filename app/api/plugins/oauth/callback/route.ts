import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { getOAuthProvider } from "@/lib/oauthProviders";
import { encryptSecret } from "@/lib/secretsVault";

const SESSION_MAX_AGE_MS = 15 * 60 * 1000;

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const origin = req.nextUrl.origin;

  if (!code || !state) {
    const denied = req.nextUrl.searchParams.get("error_description") || req.nextUrl.searchParams.get("error");
    return NextResponse.redirect(`${origin}/home?pluginError=${encodeURIComponent(denied || "Missing code or state")}`);
  }

  try {
    const db = adminDb();
    const sessionRef = db.collection("pluginOAuthSessions").doc(state);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      return NextResponse.redirect(`${origin}/home?pluginError=Login+session+expired,+please+try+again`);
    }
    const session = sessionSnap.data()!;
    if (session.createdAt && Date.now() - session.createdAt > SESSION_MAX_AGE_MS) {
      await sessionRef.delete();
      return NextResponse.redirect(`${origin}/home?pluginError=Login+session+expired,+please+try+again`);
    }
    const config = getOAuthProvider(session.toolId);
    if (!config) {
      return NextResponse.redirect(`${origin}/home?pluginError=Unknown+plugin`);
    }

    const clientId = process.env[config.clientIdEnv]!;
    const clientSecret = process.env[config.clientSecretEnv]!;

    // Notion wants HTTP Basic auth on the token request; everyone else takes the
    // credentials in the form body.
    const useBasicAuth = session.toolId === "notion";
    const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
    const form: Record<string, string> = {
      grant_type: "authorization_code",
      code,
      redirect_uri: session.redirectUri,
    };
    if (useBasicAuth) {
      headers.authorization = `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`;
    } else {
      form.client_id = clientId;
      form.client_secret = clientSecret;
    }

    const tokenRes = await fetch(config.tokenUrl, { method: "POST", headers, body: new URLSearchParams(form) });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || tokenData.error || tokenData.ok === false) {
      throw new Error(tokenData.error_description || tokenData.error || "Token exchange failed.");
    }

    // Slack returns the bot token at the top level; user-token flows nest it.
    const accessToken: string | undefined = tokenData.access_token || tokenData.authed_user?.access_token;
    if (!accessToken) throw new Error("The service didn't return an access token.");

    const meta: Record<string, any> = {};
    if (tokenData.instance_url) meta.instanceUrl = tokenData.instance_url; // Salesforce
    if (tokenData.workspace_name) meta.workspaceName = tokenData.workspace_name; // Notion
    if (tokenData.team?.name) meta.teamName = tokenData.team.name; // Slack

    await db.collection("users").doc(session.uid).collection("pluginConnections").doc(session.toolId).set({
      accessToken_enc: encryptSecret(accessToken),
      refreshToken_enc: tokenData.refresh_token ? encryptSecret(tokenData.refresh_token) : null,
      expiresAt: tokenData.expires_in ? Date.now() + tokenData.expires_in * 1000 : null,
      meta,
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