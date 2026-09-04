// lib/providers.ts
// The 10 AI providers available in the AgenticVenus model selector.
// "keyPlaceholder" and "keyHint" guide the user on where to paste their key.
// "keyDocsUrl" points to where a user can generate that provider's API key.

export type Provider = {
  id: string;
  name: string;
  description: string;
  keyPlaceholder: string;
  keyHint: string;
  keyDocsUrl: string;
  accent: string; // small color chip shown in the selector
};

export const PROVIDERS: Provider[] = [
  {
    id: "anthropic",
    name: "Claude (Anthropic)",
    description: "Claude Sonnet, Opus and Haiku models.",
    keyPlaceholder: "sk-ant-...",
    keyHint: "Found in Anthropic Console → API Keys.",
    keyDocsUrl: "https://console.anthropic.com/settings/keys",
    accent: "#D97757",
  },
  {
    id: "openai",
    name: "ChatGPT (OpenAI)",
    description: "GPT-4.1, GPT-4o and o-series models.",
    keyPlaceholder: "sk-...",
    keyHint: "Found in OpenAI Platform → API Keys.",
    keyDocsUrl: "https://platform.openai.com/api-keys",
    accent: "#10A37F",
  },
  {
    id: "google",
    name: "Gemini (Google)",
    description: "Gemini Pro and Flash models.",
    keyPlaceholder: "AIza...",
    keyHint: "Found in Google AI Studio → Get API key.",
    keyDocsUrl: "https://aistudio.google.com/app/apikey",
    accent: "#4285F4",
  },
  {
    id: "xai",
    name: "Grok (xAI)",
    description: "Grok models from xAI.",
    keyPlaceholder: "xai-...",
    keyHint: "Found in the xAI developer console.",
    keyDocsUrl: "https://console.x.ai/",
    accent: "#000000",
  },
  {
    id: "openrouter",
    name: "OpenRouter",
    description: "One key, access to 100+ models.",
    keyPlaceholder: "sk-or-...",
    keyHint: "Found in OpenRouter → Keys.",
    keyDocsUrl: "https://openrouter.ai/keys",
    accent: "#6467F2",
  },
  {
    id: "mistral",
    name: "Mistral AI",
    description: "Mistral Large, Small and Codestral.",
    keyPlaceholder: "...",
    keyHint: "Found in Mistral Console → API Keys.",
    keyDocsUrl: "https://console.mistral.ai/api-keys",
    accent: "#FA520F",
  },
  {
    id: "cohere",
    name: "Cohere",
    description: "Command R and R+ models.",
    keyPlaceholder: "...",
    keyHint: "Found in Cohere Dashboard → API Keys.",
    keyDocsUrl: "https://dashboard.cohere.com/api-keys",
    accent: "#39594D",
  },
  {
    id: "perplexity",
    name: "Perplexity",
    description: "Search-grounded Sonar models.",
    keyPlaceholder: "pplx-...",
    keyHint: "Found in Perplexity Settings → API.",
    keyDocsUrl: "https://www.perplexity.ai/settings/api",
    accent: "#20808D",
  },
  {
    id: "groq",
    name: "Groq",
    description: "Ultra-fast inference for open models.",
    keyPlaceholder: "gsk_...",
    keyHint: "Found in Groq Console → API Keys.",
    keyDocsUrl: "https://console.groq.com/keys",
    accent: "#F55036",
  },
  {
    id: "deepseek",
    name: "DeepSeek",
    description: "DeepSeek V3 and R1 reasoning models.",
    keyPlaceholder: "sk-...",
    keyHint: "Found in DeepSeek Platform → API Keys.",
    keyDocsUrl: "https://platform.deepseek.com/api_keys",
    accent: "#4D6BFE",
  },
];