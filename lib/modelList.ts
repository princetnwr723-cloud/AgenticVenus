// lib/modelList.ts
// Asks each provider which models the connected key can actually use, so
// the UI can show a real dropdown instead of a single hardcoded guess.
// This is what fixes "model not found" errors going forward — the user
// picks from what's really available today.

const NOISE = /embed|whisper|tts|dall-e|moderation|audio|realtime|image-gen/i;

export const FALLBACK_MODELS: Record<string, string[]> = {
  anthropic: ["claude-sonnet-5", "claude-opus-5", "claude-haiku-4-5-20251001"],
  openai: ["gpt-4o-mini", "gpt-4o"],
  google: ["gemini-3.6-flash", "gemini-2.5-flash"],
  xai: ["grok-4.6"],
  openrouter: ["openai/gpt-4o-mini", "anthropic/claude-3.5-sonnet"],
  mistral: ["mistral-small-latest", "mistral-large-latest"],
  groq: ["llama-3.3-70b-versatile"],
  deepseek: ["deepseek-chat"],
  perplexity: ["sonar", "sonar-pro"],
  cohere: ["command-r", "command-r-plus"],
};

export async function fetchAvailableModels(
  providerId: string,
  apiKey: string
): Promise<string[]> {
  try {
    switch (providerId) {
      case "anthropic":
        return await listAnthropic(apiKey);
      case "google":
        return await listGemini(apiKey);
      case "cohere":
        return await listCohere(apiKey);
      case "openai":
        return await listOpenAICompatible("https://api.openai.com/v1/models", apiKey);
      case "xai":
        return await listOpenAICompatible("https://api.x.ai/v1/models", apiKey);
      case "openrouter":
        return await listOpenAICompatible("https://openrouter.ai/api/v1/models", apiKey);
      case "mistral":
        return await listOpenAICompatible("https://api.mistral.ai/v1/models", apiKey);
      case "groq":
        return await listOpenAICompatible("https://api.groq.com/openai/v1/models", apiKey);
      case "deepseek":
        return await listOpenAICompatible("https://api.deepseek.com/models", apiKey);
      case "perplexity":
        // Perplexity doesn't expose a public list-models endpoint.
        return FALLBACK_MODELS.perplexity;
      default:
        return [];
    }
  } catch (err) {
    console.error(`[modelList] ${providerId} list failed, using fallback:`, err);
    return FALLBACK_MODELS[providerId] ?? [];
  }
}

async function listOpenAICompatible(url: string, apiKey: string): Promise<string[]> {
  const res = await fetch(url, { headers: { authorization: `Bearer ${apiKey}` } });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Failed to list models");
  const ids: string[] = (data.data || []).map((m: any) => m.id);
  return ids.filter((id) => !NOISE.test(id)).sort();
}

async function listAnthropic(apiKey: string): Promise<string[]> {
  const res = await fetch("https://api.anthropic.com/v1/models", {
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Failed to list models");
  return (data.data || []).map((m: any) => m.id).sort();
}

async function listGemini(apiKey: string): Promise<string[]> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
  );
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Failed to list models");
  return (data.models || [])
    .filter((m: any) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m: any) => m.name.replace("models/", ""))
    .sort();
}

async function listCohere(apiKey: string): Promise<string[]> {
  const res = await fetch("https://api.cohere.com/v1/models", {
    headers: { authorization: `Bearer ${apiKey}` },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || "Failed to list models");
  return (data.models || []).map((m: any) => m.name).sort();
}