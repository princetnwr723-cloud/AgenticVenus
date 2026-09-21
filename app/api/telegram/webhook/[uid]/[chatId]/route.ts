// app/api/telegram/webhook/[uid]/[chatId]/route.ts
// Telegram now gets full parity with the web app: scheduling, connected
// MCP/plugin actions, self-directed browser/computer use, and skill
// auto-install from a link — via runAutonomousReply (lib/serverAgentTools.ts).

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { telegramSendMessage } from "@/lib/telegramApi";
import { decryptSecret } from "@/lib/secretsVault";
import type { ChatMessage } from "@/lib/chatClient";
import { detectScheduleIntent } from "@/lib/scheduleDetect";
import { addScheduledTask, nextOccurrence } from "@/lib/scheduler";
import { runAutonomousReply, getBusinessDNAAdmin } from "@/lib/serverAgentTools";

export async function POST(
  req: NextRequest,
  { params }: { params: { uid: string; chatId: string } }
) {
  const { uid, chatId } = params;

  try {
    const update = await req.json();
    const text: string | undefined = update?.message?.text;
    const telegramChatId: number | undefined = update?.message?.chat?.id;

    if (!text || !telegramChatId) {
      return NextResponse.json({ ok: true });
    }

    const db = adminDb();
    const chatRef = db.collection("users").doc(uid).collection("chats").doc(chatId);
    const chatSnap = await chatRef.get();
    if (!chatSnap.exists) return NextResponse.json({ ok: true });

    const chat = chatSnap.data()!;
    const telegramConfig = chat.telegram;
    if (!telegramConfig?.botToken) return NextResponse.json({ ok: true });

    if (telegramConfig.telegramChatId !== telegramChatId) {
      await chatRef.set({ telegram: { telegramChatId } }, { merge: true });
    }

    let providerId: string | undefined = chat.providerId;
    let apiKey: string | undefined;
    let model: string | undefined;

    // Provider keys are stored encrypted (apiKey_enc) — decrypt, don't read a plain `apiKey`.
    if (providerId) {
      const connSnap = await db.collection("users").doc(uid).collection("connections").doc(providerId).get();
      if (connSnap.exists) {
        const enc = connSnap.data()?.apiKey_enc;
        apiKey = enc ? decryptSecret(enc) : undefined;
        model = connSnap.data()?.model;
      }
    }
    if (!apiKey) {
      const connsSnap = await db.collection("users").doc(uid).collection("connections").orderBy("connectedAt", "desc").limit(1).get();
      if (!connsSnap.empty) {
        const d = connsSnap.docs[0].data();
        providerId = d.providerId;
        apiKey = d.apiKey_enc ? decryptSecret(d.apiKey_enc) : undefined;
        model = d.model;
      }
    }

    if (!providerId || !apiKey) {
      await telegramSendMessage(telegramConfig.botToken, telegramChatId, "This AgenticVenus chat doesn't have an AI provider connected yet — connect one in the app first.");
      return NextResponse.json({ ok: true });
    }

    const messages: ChatMessage[] = [...(chat.messages || []), { role: "user", content: text }];

    // 0. Scheduling — same as the web app.
    const intent = await detectScheduleIntent(providerId, apiKey, text, model);
    if (intent) {
      const runAt = nextOccurrence(intent.time);
      await addScheduledTask(uid, intent.taskMessage, runAt, intent.recurrence, chatId);
      const reply = `Done — I've scheduled "${intent.taskMessage}" to run ${intent.recurrence === "daily" ? "every day" : intent.recurrence === "hourly" ? "every hour" : "once"} at ${intent.time}.`;
      const updatedMessages = [...messages, { role: "assistant" as const, content: reply }];
      await chatRef.update({ messages: updatedMessages, updatedAt: new Date() });
      await telegramSendMessage(telegramConfig.botToken, telegramChatId, reply);
      return NextResponse.json({ ok: true });
    }

    // 1. Full autonomous loop — MCP/plugin actions, browser/computer, skills.
    const dna = await getBusinessDNAAdmin(uid);
    const { text: replyText, agentId } = await runAutonomousReply(uid, providerId, apiKey, chat.agentId, messages, dna, model);

    const updatedMessages = [...messages, { role: "assistant" as const, content: replyText }];
    await chatRef.update({ messages: updatedMessages, agentId, updatedAt: new Date() });
    await telegramSendMessage(telegramConfig.botToken, telegramChatId, replyText);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/telegram/webhook]", err);
    return NextResponse.json({ ok: true });
  }
}