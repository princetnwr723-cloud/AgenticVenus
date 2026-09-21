// lib/pluginRuntime.ts
// Server-only. The ONE place that turns "user X wants action Y on plugin Z"
// into a real call: it loads the stored connection, decrypts the token/key,
// refreshes an expired OAuth token, runs the action, and retries once if the
// provider says the token was rejected.
//
// Both /api/plugins/call (web app) and lib/serverAgentTools.ts (Telegram,
// scheduled jobs) use it, so the two can never drift apart again. Previously the
// Telegram path read `conn.accessToken` while tokens are stored encrypted as
// `accessToken_enc`, so plugins silently failed there.

import { adminDb } from "@/lib/firebaseAdmin";
import { getOAuthProvider, type OAuthProviderConfig } from "@/lib/oauthProviders";
import { API_KEY_PROVIDERS } from "@/lib/apiKeyProviders";
import { decryptSecret, encryptSecret } from "@/lib/secretsVault";
import { executePluginAction } from "@/lib/pluginActions";
import { PLUGIN_ACTIONS, type PluginCredential } from "@/lib/pluginCatalog";

type Ref = FirebaseFirestore.DocumentReference;

async function refreshOAuthToken(ref: Ref, data: FirebaseFirestore.DocumentData, config: OAuthProviderConfig): Promise<string | null> {
  if (!data.refreshToken_enc) return null;
  const refreshToken = decryptSecret(data.refreshToken_enc);
  const res = await fetch(config.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: process.env[config.clientIdEnv]!,
      client_secret: process.env[config.clientSecretEnv]!,
    }),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || !json?.access_token) return null;
  await ref.update({
    accessToken_enc: encryptSecret(json.access_token),
    ...(json.refresh_token ? { refreshToken_enc: encryptSecret(json.refresh_token) } : {}),
    expiresAt: Date.now() + (json.expires_in ? json.expires_in * 1000 : 55 * 60 * 1000),
  });
  return json.access_token as string;
}

export async function runPluginAction(uid: string, toolId: string, actionId: string, params: Record<string, any>): Promise<string> {
  const def = PLUGIN_ACTIONS.find((a) => a.id === actionId);
  if (!def || def.toolId !== toolId) throw new Error(`"${actionId}" isn't an action of ${toolId}.`);

  const ref = adminDb().collection("users").doc(uid).collection("pluginConnections").doc(toolId);
  const snap = await ref.get();
  const data = snap.exists ? snap.data()! : null;

  const oauth = getOAuthProvider(toolId);
  const apiKeyConfig = API_KEY_PROVIDERS[toolId];
  let cred: PluginCredential = {};
  let refreshable = false;

  if (def.noAuth) {
    if (!data) throw new Error(`${toolId} isn't switched on — turn it on in Plugins first.`);
  } else if (oauth) {
    if (!data?.accessToken_enc) {
      throw new Error(`${oauth.displayName} isn't connected with a real login yet — open Plugins and press “Continue with ${oauth.displayName}”.`);
    }
    let accessToken = decryptSecret(data.accessToken_enc);
    if (data.expiresAt && Date.now() > data.expiresAt - 60_000) {
      const fresh = await refreshOAuthToken(ref, data, oauth).catch(() => null);
      if (fresh) accessToken = fresh;
    }
    cred = { accessToken, meta: data.meta || {} };
    refreshable = !!data.refreshToken_enc;
  } else if (apiKeyConfig) {
    if (!data?.apiKey_enc) throw new Error(`${apiKeyConfig.displayName} needs its ${apiKeyConfig.keyLabel} — add it in Plugins.`);
    cred = { apiKey: decryptSecret(data.apiKey_enc) };
  } else if (!data) {
    throw new Error(`${toolId} isn't connected.`);
  }

  try {
    return await executePluginAction(actionId, cred, params);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (oauth && refreshable && data && /\b401\b|unauthori[sz]ed|invalid[_ ]token|expired|invalid_auth/i.test(message)) {
      const fresh = await refreshOAuthToken(ref, data, oauth).catch(() => null);
      if (fresh) return executePluginAction(actionId, { ...cred, accessToken: fresh }, params);
    }
    throw err;
  }
}