// lib/chatClient.ts
// Sends a conversation to whichever provider the user connected, using
// their own API key. Each provider has a slightly different request/
// response shape, so this file normalizes them into one function, and
// also normalizes each provider's own token-usage numbers so the UI can
// show "X tokens used" under a reply instead of guessing.
//
// IMPORTANT: these calls run directly from the browser. Some providers
// (OpenAI, Google, etc.) don't send CORS headers that allow browser-side
// requests from arbitrary origins, so calls may fail with a network/CORS
// error in production. For a real deployment, move these calls behind a
// server route so the request comes from your server, not the user's
// browser.

export type Attachment = {
  name: string;
  mimeType: string;
  dataUrl: string; // data:<mime>;base64,<data>
};

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
  usage?: TokenUsage;
  attachments?: Attachment[];
};

export type TokenUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type ChatResult = {
  text: string;
  usage?: TokenUsage;
};

type SendArgs = {
  providerId: string;
  apiKey: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  model?: string;
};

export async function sendChatMessage({
  providerId,
  apiKey,
  messages,
  systemPrompt,
  model,
}: SendArgs): Promise<ChatResult> {
  try {
    switch (providerId) {
      case "anthropic":
        return await callAnthropic(apiKey, messages, systemPrompt, model);
      case "google":
        return await callGemini(apiKey, messages, systemPrompt, model);
      case "cohere":
        return await callCohere(apiKey, messages, systemPrompt, model);
      case "openai":
        return await callOpenAiCompatible(
          "https://api.openai.com/v1/chat/completions", apiKey, messages, model || "gpt-4o-mini", systemPrompt
        );
      case "xai":
        return await callOpenAiCompatible(
          "https://api.x.ai/v1/chat/completions", apiKey, messages, model || "grok-4.6", systemPrompt
        );
      case "openrouter":
        return await callOpenAiCompatible(
          "https://openrouter.ai/api/v1/chat/completions", apiKey, messages, model || "openai/gpt-4o-mini", systemPrompt
        );
      case "mistral":
        return await callOpenAiCompatible(
          "https://api.mistral.ai/v1/chat/completions", apiKey, messages, model || "mistral-small-latest", systemPrompt
        );
      case "groq":
        return await callOpenAiCompatible(
          "https://api.groq.com/openai/v1/chat/completions", apiKey, messages, model || "openai/gpt-oss-120b", systemPrompt
        );
      case "deepseek":
        return await callOpenAiCompatible(
          "https://api.deepseek.com/chat/completions", apiKey, messages, model || "deepseek-chat", systemPrompt
        );
      case "perplexity":
        return await callOpenAiCompatible(
          "https://api.perplexity.ai/chat/completions", apiKey, messages, model || "sonar", systemPrompt
        );
      default:
        throw new Error("Unknown provider");
    }
  } catch (err) {
    console.error("[chatClient]", err);
    throw new Error(friendlyError(err));
  }
}

function friendlyError(err: unknown): string {
  if (err instanceof TypeError) {
    return "Couldn't reach this provider from the browser. Some providers block direct browser requests (CORS) — for production, proxy this call through a small server route. Check the browser console for details.";
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}

function toMessages(messages: ChatMessage[]) {
  return messages.map((m) => ({ role: m.role, content: m.content }));
}

function base64Only(dataUrl: string): string {
  const idx = dataUrl.indexOf(",");
  return idx >= 0 ? dataUrl.slice(idx + 1) : dataUrl;
}

function toAnthropicMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    const images = (m.attachments || []).filter((a) => a.mimeType.startsWith("image/"));
    if (images.length === 0) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        ...images.map((a) => ({
          type: "image",
          source: { type: "base64", media_type: a.mimeType, data: base64Only(a.dataUrl) },
        })),
        { type: "text", text: m.content || "(see attached image)" },
      ],
    };
  });
}

function toOpenAiMessages(messages: ChatMessage[]) {
  return messages.map((m) => {
    const images = (m.attachments || []).filter((a) => a.mimeType.startsWith("image/"));
    if (images.length === 0) return { role: m.role, content: m.content };
    return {
      role: m.role,
      content: [
        { type: "text", text: m.content || "(see attached image)" },
        ...images.map((a) => ({ type: "image_url", image_url: { url: a.dataUrl } })),
      ],
    };
  });
}

// ---------- Anthropic (Claude) ----------
async function callAnthropic(
  apiKey: string, messages: ChatMessage[], systemPrompt?: string, model?: string
): Promise<ChatResult> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: model || "claude-sonnet-5",
      max_tokens: 1024,
      ...(systemPrompt ? { system: systemPrompt } : {}),
      messages: toAnthropicMessages(messages),
    }),
  });
  const data = await parseOrThrow(res);
  const text = data?.content?.[0]?.text ?? "(empty response)";
  const usage = data?.usage
    ? {
        inputTokens: data.usage.input_tokens ?? 0,
        outputTokens: data.usage.output_tokens ?? 0,
        totalTokens: (data.usage.input_tokens ?? 0) + (data.usage.output_tokens ?? 0),
      }
    : undefined;
  return { text, usage };
}

// ---------- Google Gemini ----------
async function callGemini(
  apiKey: string, messages: ChatMessage[], systemPrompt?: string, model?: string
): Promise<ChatResult> {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [
      { text: m.content },
      ...(m.attachments || [])
        .filter((a) => a.mimeType.startsWith("image/"))
        .map((a) => ({ inline_data: { mime_type: a.mimeType, data: base64Only(a.dataUrl) } })),
    ],
  }));
  const body = JSON.stringify({
    contents,
    ...(systemPrompt ? { systemInstruction: { parts: [{ text: systemPrompt }] } } : {}),
  });

  const tryModel = async (m: string) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "content-type": "application/json" }, body }
    );
    return { res, data: await res.json().catch(() => null) };
  };

  let { res, data } = await tryModel(model || "gemini-3.6-flash");

  if (!res.ok && (data?.error?.message || "").toLowerCase().includes("no longer available")) {
    const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
    const listData = await listRes.json().catch(() => null);
    const candidate = listData?.models?.find(
      (m: any) => m.supportedGenerationMethods?.includes("generateContent") && /flash/i.test(m.name)
    );
    if (candidate) {
      const modelId = candidate.name.replace("models/", "");
      ({ res, data } = await tryModel(modelId));
    }
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || `Request failed (${res.status})`);
  }
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "(empty response)";
  const usageMeta = data?.usageMetadata;
  const usage = usageMeta
    ? {
        inputTokens: usageMeta.promptTokenCount ?? 0,
        outputTokens: usageMeta.candidatesTokenCount ?? 0,
        totalTokens: usageMeta.totalTokenCount ?? 0,
      }
    : undefined;
  return { text, usage };
}

// ---------- Cohere ----------
async function callCohere(
  apiKey: string, messages: ChatMessage[], systemPrompt?: string, model?: string
): Promise<ChatResult> {
  const chatMessages = systemPrompt ? [{ role: "system", content: systemPrompt }, ...messages] : messages;
  const res = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: model || "command-r",
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await parseOrThrow(res);
  const text = data?.message?.content?.[0]?.text ?? "(empty response)";
  const usage = data?.usage?.tokens
    ? {
        inputTokens: data.usage.tokens.input_tokens ?? 0,
        outputTokens: data.usage.tokens.output_tokens ?? 0,
        totalTokens: (data.usage.tokens.input_tokens ?? 0) + (data.usage.tokens.output_tokens ?? 0),
      }
    : undefined;
  return { text, usage };
}

// ---------- OpenAI-compatible (OpenAI, xAI, OpenRouter, Mistral, Groq, DeepSeek, Perplexity) ----------
async function callOpenAiCompatible(
  url: string, apiKey: string, messages: ChatMessage[], model: string, systemPrompt?: string
): Promise<ChatResult> {
  const chatMessages = systemPrompt ? [{ role: "system", content: systemPrompt }, ...messages] : messages;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: toOpenAiMessages(chatMessages as ChatMessage[]),
    }),
  });
  const data = await parseOrThrow(res);
  const text = data?.choices?.[0]?.message?.content ?? "(empty response)";
  const usage = data?.usage
    ? {
        inputTokens: data.usage.prompt_tokens ?? 0,
        outputTokens: data.usage.completion_tokens ?? 0,
        totalTokens: data.usage.total_tokens ?? 0,
      }
    : undefined;
  return { text, usage };
}

async function parseOrThrow(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data?.error?.message || data?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}