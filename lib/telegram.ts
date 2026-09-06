// lib/telegram.ts
// Client-side calls into the /api/telegram/* routes from the Settings
// panel. The actual Telegram Bot API calls happen server-side (see
// lib/telegramApi.ts) since they aren't reliably reachable from a
// browser with CORS.

import { auth } from "@/lib/firebase";

async function authHeader() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { authorization: `Bearer ${idToken}` };
}

export async function connectTelegram(chatId: string, botToken: string): Promise<string> {
  const res = await fetch("/api/telegram/setup", {
    method: "POST",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ chatId, botToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to connect Telegram.");
  return data.botUsername as string;
}

export async function disconnectTelegram(chatId: string, botToken?: string): Promise<void> {
  const res = await fetch("/api/telegram/setup", {
    method: "DELETE",
    headers: { "content-type": "application/json", ...(await authHeader()) },
    body: JSON.stringify({ chatId, botToken }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to disconnect Telegram.");
}