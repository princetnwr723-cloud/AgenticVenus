// lib/oauthProviders.ts
// One dedicated OAuth 2.0 config per plugin — this is what makes
// "Continue with Gmail" work exactly like Grok/Claude: AgenticVenus is
// registered as a real OAuth app with that service (client id + secret,
// set as env vars), so there's no dynamic client registration or
// guessing involved, just the standard authorization code flow.
//
// To add a new plugin here: create an OAuth app in that service's
// developer console, add its client id/secret as env vars, and add an
// entry below. The actual API calls the tool can make (send an email,
// post a Slack message, etc.) live in lib/pluginActions.ts.

export type OAuthProviderConfig = {
  toolId: string;
  displayName: string;
  authorizationUrl: string;
  tokenUrl: string;
  scopes: string[];
  clientIdEnv: string;
  clientSecretEnv: string;
  extraAuthParams?: Record<string, string>;
};

export const OAUTH_PROVIDERS: Record<string, OAuthProviderConfig> = {
  gmail: {
    toolId: "gmail",
    displayName: "Gmail",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: [
      "https://www.googleapis.com/auth/gmail.send",
      "https://www.googleapis.com/auth/gmail.compose",
      "https://www.googleapis.com/auth/gmail.readonly",
    ],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    // Needed to reliably get a refresh_token back from Google.
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  slack: {
    toolId: "slack",
    displayName: "Slack",
    authorizationUrl: "https://slack.com/oauth/v2/authorize",
    tokenUrl: "https://slack.com/api/oauth.v2.access",
    scopes: ["chat:write", "channels:read", "channels:history"],
    clientIdEnv: "SLACK_CLIENT_ID",
    clientSecretEnv: "SLACK_CLIENT_SECRET",
  },
};

export function getOAuthProvider(toolId: string): OAuthProviderConfig | null {
  return OAUTH_PROVIDERS[toolId] ?? null;
}

export function isEnvConfigured(config: OAuthProviderConfig): boolean {
  return !!process.env[config.clientIdEnv] && !!process.env[config.clientSecretEnv];
}