// lib/mcpOAuth.ts
// Implements the standard MCP remote-server auth flow (OAuth 2.1 +
// PKCE + optional Dynamic Client Registration, per RFC9728/RFC8414/
// RFC7591) so connecting a server like Creatify or Gmail's MCP can work
// the same way Claude.ai's "Continue to X" button does — no manual API
// key pasting needed when the server supports it.

import crypto from "crypto";

export type OAuthDiscovery = {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
  scope?: string;
};

function base64url(input: Buffer): string {
  return input.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function generatePkce() {
  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

/** Probes an MCP server without credentials to see what kind of auth it
 * needs: none (works already), oauth (discovery succeeded), or apikey
 * (fallback — the user pastes a static Authorization header). */
export async function probeMcpAuth(
  serverUrl: string
): Promise<
  | { authType: "none" }
  | { authType: "oauth"; authorizationEndpoint: string; tokenEndpoint: string; registrationEndpoint?: string; scope?: string }
  | { authType: "apikey" }
> {
  const res = await fetch(serverUrl, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "AgenticVenus", version: "1.0.0" } },
    }),
  });

  if (res.ok) return { authType: "none" };
  if (res.status !== 401) return { authType: "apikey" };

  try {
    const wwwAuth = res.headers.get("www-authenticate") || "";
    const resourceMetaMatch = wwwAuth.match(/resource_metadata="([^"]+)"/);
    let resourceMetadataUrl = resourceMetaMatch?.[1];

    if (!resourceMetadataUrl) {
      // Fall back to the conventional well-known path on the server's own origin.
      const origin = new URL(serverUrl).origin;
      resourceMetadataUrl = `${origin}/.well-known/oauth-protected-resource`;
    }

    const resourceMeta = await fetch(resourceMetadataUrl).then((r) => r.json());
    const authServerUrl: string = resourceMeta.authorization_servers?.[0] || resourceMeta.authorization_server;
    if (!authServerUrl) return { authType: "apikey" };

    const authServerMetaUrl = `${authServerUrl.replace(/\/$/, "")}/.well-known/oauth-authorization-server`;
    const authMeta = await fetch(authServerMetaUrl).then((r) => r.json());

    return {
      authType: "oauth",
      authorizationEndpoint: authMeta.authorization_endpoint,
      tokenEndpoint: authMeta.token_endpoint,
      registrationEndpoint: authMeta.registration_endpoint,
      scope: Array.isArray(resourceMeta.scopes_supported) ? resourceMeta.scopes_supported.join(" ") : undefined,
    };
  } catch {
    return { authType: "apikey" };
  }
}

/** Registers AgenticVenus as an OAuth client with the server's
 * authorization server, if it supports Dynamic Client Registration —
 * otherwise there's nothing to register and the server must be
 * pre-configured with a static client (rare for MCP). */
export async function registerOAuthClient(
  registrationEndpoint: string,
  redirectUri: string
): Promise<string> {
  const res = await fetch(registrationEndpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "AgenticVenus",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.client_id) {
    throw new Error(data?.error_description || "Dynamic client registration failed.");
  }
  return data.client_id;
}

export async function exchangeCodeForTokens(
  tokenEndpoint: string,
  code: string,
  codeVerifier: string,
  clientId: string,
  redirectUri: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      code_verifier: codeVerifier,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description || "Token exchange failed.");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 55 * 60 * 1000),
  };
}

export async function refreshAccessToken(
  tokenEndpoint: string,
  refreshToken: string,
  clientId: string
): Promise<{ accessToken: string; refreshToken?: string; expiresAt: number }> {
  const res = await fetch(tokenEndpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error_description || "Token refresh failed.");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresAt: Date.now() + (data.expires_in ? data.expires_in * 1000 : 55 * 60 * 1000),
  };
}