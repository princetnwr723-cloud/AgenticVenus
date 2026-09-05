// lib/chatClient.ts
// Sends a conversation to whichever provider the user connected, using
// their own API key. Each provider has a slightly different request/
// response shape, so this file normalizes them into one function. An
// optional `model` override lets the caller use whichever model the user
// picked from the live model list (see lib/modelList.ts) instead of the
// hardcoded default — that's what prevents "model not found" errors as
// providers retire/rename models over time.
//
// IMPORTANT: these calls run directly from the browser. Some providers
// (OpenAI, Google, etc.) don't send CORS headers that allow browser-side
// requests from arbitrary origins, so calls may fail with a network/CORS
// error in production. For a real deployment, move these calls behind a
// server route (Next.js Route Handler) so the request comes from your
// server, not the user's browser. This client-side version is meant to
// get the flow working end-to-end for the demo.

export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

type SendArgs = {
  providerId: string;
  apiKey: string;
  messages: ChatMessage[];
  /** Optional system instructions — used to give the agent a persona
   * (Agent Team) and/or business context (Business DNA). */
  systemPrompt?: string;
  /** Optional specific model id to use instead of the provider's default. */
  model?: string;
};

export async function sendChatMessage({
  providerId,
  apiKey,
  messages,
  systemPrompt,
  model,
}: SendArgs): Promise<string> {
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
          "https://api.openai.com/v1/chat/completions",
          apiKey,
          messages,
          model || "gpt-4o-mini",
          systemPrompt
        );
      case "xai":
        return await callOpenAiCompatible(
          "https://api.x.ai/v1/chat/completions",
          apiKey,
          messages,
          model || "grok-4.6",
          systemPrompt
        );
      case "openrouter":
        return await callOpenAiCompatible(
          "https://openrouter.ai/api/v1/chat/completions",
          apiKey,
          messages,
          model || "openai/gpt-4o-mini",
          systemPrompt
        );
      case "mistral":
        return await callOpenAiCompatible(
          "https://api.mistral.ai/v1/chat/completions",
          apiKey,
          messages,
          model || "mistral-small-latest",
          systemPrompt
        );
      case "groq":
        return await callOpenAiCompatible(
          "https://api.groq.com/openai/v1/chat/completions",
          apiKey,
          messages,
          model || "llama-3.3-70b-versatile",
          systemPrompt
        );
      case "deepseek":
        return await callOpenAiCompatible(
          "https://api.deepseek.com/chat/completions",
          apiKey,
          messages,
          model || "deepseek-chat",
          systemPrompt
        );
      case "perplexity":
        return await callOpenAiCompatible(
          "https://api.perplexity.ai/chat/completions",
          apiKey,
          messages,
          model || "sonar",
          systemPrompt
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

// ---------- Anthropic (Claude) ----------
async function callAnthropic(
  apiKey: string,
  messages: ChatMessage[],
  systemPrompt?: string,
  model?: string
) {
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
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await parseOrThrow(res);
  return data?.content?.[0]?.text ?? "(empty response)";
}

// ---------- Google Gemini ----------
async function callGemini(
  apiKey: string,
  messages: ChatMessage[],
  systemPrompt?: string,
  model?: string
) {
  const contents = messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const body = JSON.stringify({
    contents,
    ...(systemPrompt
      ? { systemInstruction: { parts: [{ text: systemPrompt }] } }
      : {}),
  });

  const tryModel = async (m: string) => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "content-type": "application/json" }, body }
    );
    return { res, data: await res.json().catch(() => null) };
  };

  let { res, data } = await tryModel(model || "gemini-3.6-flash");

  // Google retires/renames Gemini models often — if our model guess is
  // stale, fall back to asking the API which model to use.
  if (!res.ok && (data?.error?.message || "").toLowerCase().includes("no longer available")) {
    const listRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );
    const listData = await listRes.json().catch(() => null);
    const candidate = listData?.models?.find(
      (m: any) =>
        m.supportedGenerationMethods?.includes("generateContent") &&
        /flash/i.test(m.name)
    );
    if (candidate) {
      const modelId = candidate.name.replace("models/", "");
      ({ res, data } = await tryModel(modelId));
    }
  }

  if (!res.ok) {
    throw new Error(data?.error?.message || `Request failed (${res.status})`);
  }
  return (
    data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "(empty response)"
  );
}

// ---------- Cohere ----------
async function callCohere(
  apiKey: string,
  messages: ChatMessage[],
  systemPrompt?: string,
  model?: string
) {
  const chatMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;
  const res = await fetch("https://api.cohere.com/v2/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: model || "command-r",
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await parseOrThrow(res);
  return data?.message?.content?.[0]?.text ?? "(empty response)";
}

// ---------- OpenAI-compatible (OpenAI, xAI, OpenRouter, Mistral, Groq, DeepSeek, Perplexity) ----------
async function callOpenAiCompatible(
  url: string,
  apiKey: string,
  messages: ChatMessage[],
  model: string,
  systemPrompt?: string
) {
  const chatMessages = systemPrompt
    ? [{ role: "system", content: systemPrompt }, ...messages]
    : messages;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: chatMessages.map((m) => ({ role: m.role, content: m.content })),
    }),
  });
  const data = await parseOrThrow(res);
  return data?.choices?.[0]?.message?.content ?? "(empty response)";
}

async function parseOrThrow(res: Response) {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data?.error?.message || data?.message || `Request failed (${res.status})`;
    throw new Error(message);
  }
  return data;
}