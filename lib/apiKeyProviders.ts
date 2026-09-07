// lib/apiKeyProviders.ts
// A handful of plugins aren't "log into your account" tools at all —
// they're powered by a single API key/token (Wolfram Alpha, Perplexity's
// search API, Zapier's NLA, Make's API token). These get a simple
// "paste your key" field in Plugins instead of an OAuth redirect.

export type ApiKeyProviderConfig = {
  toolId: string;
  displayName: string;
  keyLabel: string;
  helpUrl: string;
};

export const API_KEY_PROVIDERS: Record<string, ApiKeyProviderConfig> = {
  wolfram: {
    toolId: "wolfram",
    displayName: "Wolfram Alpha",
    keyLabel: "App ID",
    helpUrl: "https://developer.wolframalpha.com/access",
  },
  "perplexity-search": {
    toolId: "perplexity-search",
    displayName: "Perplexity Search",
    keyLabel: "API key",
    helpUrl: "https://www.perplexity.ai/settings/api",
  },
  zapier: {
    toolId: "zapier",
    displayName: "Zapier",
    keyLabel: "NLA API key",
    helpUrl: "https://nla.zapier.com/docs/",
  },
  make: {
    toolId: "make",
    displayName: "Make",
    keyLabel: "API token",
    helpUrl: "https://www.make.com/en/api-documentation",
  },
};

export function getApiKeyProvider(toolId: string): ApiKeyProviderConfig | null {
  return API_KEY_PROVIDERS[toolId] ?? null;
}