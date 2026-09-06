// app/api/telegram/webhook/[uid]/[chatId]/route.ts
// Telegram calls this URL whenever a message arrives for the bot
// connected to a specific AgenticVenus conversation. It loads that
// chat's history + connected provider, gets a reply from the same agent
// persona the conversation was using, saves it back into the chat, and
// sends it to Telegram — so the chat updates whether the user is talking
// to it from the web app or from Telegram.
//
// The URL itself (containing uid + chatId) acts as the shared secret here
// — Telegram doesn't support custom auth headers on webhooks. For extra
// hardening later, Telegram's `secret_token` webhook option can be added.

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { telegramSendMessage } from "@/lib/telegramApi";
import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { getAgentById } from "@/lib/agents";
import { buildBusinessContext, type BusinessDNA } from "@/lib/businessDNA";

export async function POST(
  req: NextRequest,
  { params }: { params: { uid: string; chatId: string } }
) {
  const { uid, chatId } = params;

  try {
    const update = await req.json();
    const text: string | undefined = update?.message?.text;
    const telegramChatId: number | undefined = update?.message?.chat?.id;

    // Telegram sends other update types too (edits, joins, etc.) — ignore
    // anything that isn't a plain text message.
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

    // Remember which Telegram chat this bot is talking to, so future
    // triggers (e.g. Scheduler) could message it directly too.
    if (telegramConfig.telegramChatId !== telegramChatId) {
      await chatRef.set({ telegram: { telegramChatId } }, { merge: true });
    }

    // Resolve which provider/key/model to answer with: the one this chat
    // was last using, falling back to the user's most recently connected one.
    let providerId: string | undefined = chat.providerId;
    let apiKey: string | undefined;
    let model: string | undefined;

    if (providerId) {
      const connSnap = await db
        .collection("users").doc(uid).collection("connections").doc(providerId).get();
      if (connSnap.exists) {
        apiKey = connSnap.data()?.apiKey;
        model = connSnap.data()?.model;
      }
    }
    if (!apiKey) {
      const connsSnap = await db
        .collection("users").doc(uid).collection("connections")
        .orderBy("connectedAt", "desc").limit(1).get();
      if (!connsSnap.empty) {
        const d = connsSnap.docs[0].data();
        providerId = d.providerId;
        apiKey = d.apiKey;
        model = d.model;
      }
    }

    if (!providerId || !apiKey) {
      await telegramSendMessage(
        telegramConfig.botToken,
        telegramChatId,
        "This AgenticVenus chat doesn't have an AI provider connected yet — connect one in the app first."
      );
      return NextResponse.json({ ok: true });
    }

    const messages: ChatMessage[] = [...(chat.messages || []), { role: "user", content: text }];

    const agent = getAgentById(chat.agentId || "generalist");
    const dnaSnap = await db.collection("users").doc(uid).collection("settings").doc("businessDNA").get();
    const dna = dnaSnap.exists ? (dnaSnap.data() as BusinessDNA) : null;
    const systemPrompt = [agent.systemPrompt, buildBusinessContext(dna)].filter(Boolean).join("\n\n");

    const reply = await sendChatMessage({ providerId, apiKey, messages, systemPrompt, model });

    const updatedMessages = [...messages, { role: "assistant" as const, content: reply.text }];
    await chatRef.update({ messages: updatedMessages, updatedAt: new Date() });

    await telegramSendMessage(telegramConfig.botToken, telegramChatId, reply.text);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/telegram/webhook]", err);
    // Always 200 back to Telegram — a non-200 makes it retry the same
    // update repeatedly, which isn't useful here.
    return NextResponse.json({ ok: true });
  }
}