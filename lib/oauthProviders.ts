// lib/oauthProviders.ts
// One dedicated OAuth 2.0 config per plugin — this is what makes
// "Continue with X" work exactly like Grok/Claude: AgenticVenus is
// registered as a real OAuth app with that service (client id + secret,
// set as env vars), so there's no dynamic client registration or
// guessing involved, just the standard authorization code flow.
//
// The /api/plugins/oauth/* routes and the Plugins panel are already
// generic — adding a tool here is the ONLY step needed to make its
// "Continue with X" button appear and work. Actually DOING something
// with it (sending an email, posting a Slack message, etc.) is a
// separate step in lib/pluginActions.ts once you're ready for that tool.
//
// Note: Google's 3 tools (Gmail, Calendar, Drive) share ONE Google Cloud
// OAuth app — just request different scopes. Same for Microsoft's 5
// tools (Outlook Mail/Calendar, OneDrive, SharePoint, Teams), which share
// one Azure AD app. So you only need to register 8 distinct OAuth apps
// total to cover all 13 tools below, not 13.

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
  // ---------- Google (1 app → GOOGLE_OAUTH_CLIENT_ID/SECRET) ----------
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
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  "google-calendar": {
    toolId: "google-calendar",
    displayName: "Google Calendar",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/calendar"],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  "google-drive": {
    toolId: "google-drive",
    displayName: "Google Drive",
    authorizationUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    scopes: ["https://www.googleapis.com/auth/drive"],
    clientIdEnv: "GOOGLE_OAUTH_CLIENT_ID",
    clientSecretEnv: "GOOGLE_OAUTH_CLIENT_SECRET",
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },

  // ---------- Microsoft (1 app → MICROSOFT_CLIENT_ID/SECRET) ----------
  "outlook-mail": {
    toolId: "outlook-mail",
    displayName: "Outlook Mail",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "Mail.ReadWrite", "Mail.Send"],
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
  },
  "outlook-calendar": {
    toolId: "outlook-calendar",
    displayName: "Outlook Calendar",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "Calendars.ReadWrite"],
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
  },
  onedrive: {
    toolId: "onedrive",
    displayName: "OneDrive",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "Files.ReadWrite"],
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
  },
  sharepoint: {
    toolId: "sharepoint",
    displayName: "SharePoint",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "Sites.ReadWrite.All"],
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
  },
  "ms-teams": {
    toolId: "ms-teams",
    displayName: "Microsoft Teams",
    authorizationUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    scopes: ["offline_access", "Chat.ReadWrite", "ChannelMessage.Send"],
    clientIdEnv: "MICROSOFT_CLIENT_ID",
    clientSecretEnv: "MICROSOFT_CLIENT_SECRET",
  },

  // ---------- Everyone else (own app each) ----------
  notion: {
    toolId: "notion",
    displayName: "Notion",
    authorizationUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    scopes: [],
    clientIdEnv: "NOTION_CLIENT_ID",
    clientSecretEnv: "NOTION_CLIENT_SECRET",
    extraAuthParams: { owner: "user" },
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
  github: {
    toolId: "github",
    displayName: "GitHub",
    authorizationUrl: "https://github.com/login/oauth/authorize",
    tokenUrl: "https://github.com/login/oauth/access_token",
    scopes: ["repo", "read:user"],
    clientIdEnv: "GITHUB_CLIENT_ID",
    clientSecretEnv: "GITHUB_CLIENT_SECRET",
  },
  linear: {
    toolId: "linear",
    displayName: "Linear",
    authorizationUrl: "https://linear.app/oauth/authorize",
    tokenUrl: "https://api.linear.app/oauth/token",
    scopes: ["read", "write"],
    clientIdEnv: "LINEAR_CLIENT_ID",
    clientSecretEnv: "LINEAR_CLIENT_SECRET",
  },
  vercel: {
    toolId: "vercel",
    displayName: "Vercel",
    authorizationUrl: "https://vercel.com/oauth/authorize",
    tokenUrl: "https://api.vercel.com/login/oauth/token",
    scopes: ["openid", "email", "profile", "offline_access"],
    clientIdEnv: "VERCEL_CLIENT_ID",
    clientSecretEnv: "VERCEL_CLIENT_SECRET",
  },
  salesforce: {
    toolId: "salesforce",
    displayName: "Salesforce",
    authorizationUrl: "https://login.salesforce.com/services/oauth2/authorize",
    tokenUrl: "https://login.salesforce.com/services/oauth2/token",
    scopes: ["api", "refresh_token"],
    clientIdEnv: "SALESFORCE_CLIENT_ID",
    clientSecretEnv: "SALESFORCE_CLIENT_SECRET",
  },
  hubspot: {
    toolId: "hubspot",
    displayName: "HubSpot",
    authorizationUrl: "https://app.hubspot.com/oauth/authorize",
    tokenUrl: "https://api.hubapi.com/oauth/v1/token",
    scopes: ["crm.objects.contacts.read", "crm.objects.contacts.write"],
    clientIdEnv: "HUBSPOT_CLIENT_ID",
    clientSecretEnv: "HUBSPOT_CLIENT_SECRET",
  },
  canva: {
    toolId: "canva",
    displayName: "Canva",
    authorizationUrl: "https://www.canva.com/api/oauth/authorize",
    tokenUrl: "https://api.canva.com/rest/v1/oauth/token",
    scopes: ["design:content:read", "design:content:write"],
    clientIdEnv: "CANVA_CLIENT_ID",
    clientSecretEnv: "CANVA_CLIENT_SECRET",
  },
};

export function getOAuthProvider(toolId: string): OAuthProviderConfig | null {
  return OAUTH_PROVIDERS[toolId] ?? null;
}

export function isEnvConfigured(config: OAuthProviderConfig): boolean {
  return !!process.env[config.clientIdEnv] && !!process.env[config.clientSecretEnv];
}