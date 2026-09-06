// lib/telegramApi.ts
// Thin wrapper around the Telegram Bot API. Server-side only (these calls
// aren't reliably reachable with CORS from a browser), used by the
// /api/telegram/* routes.

export async function telegramSetWebhook(botToken: string, webhookUrl: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url: webhookUrl }),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Telegram rejected the webhook.");
  return data;
}

export async function telegramSendMessage(botToken: string, chatId: number | string, text: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const data = await res.json().catch(() => null);
  if (!data?.ok) {
    console.error("[telegram] sendMessage failed:", data);
  }
  return data;
}

export async function telegramGetMe(botToken: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/getMe`);
  const data = await res.json();
  if (!data.ok) throw new Error(data.description || "Invalid bot token.");
  return data.result as { username: string; first_name: string };
}