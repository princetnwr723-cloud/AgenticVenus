// app/api/telegram/setup/route.ts
// Called from Settings when the user connects a Telegram bot to a
// specific conversation. Verifies the request really comes from that
// signed-in user, saves the bot token against that chat, and registers
// the webhook with Telegram so messages get routed to
// /api/telegram/webhook/[uid]/[chatId].

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { telegramGetMe, telegramSetWebhook } from "@/lib/telegramApi";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const idToken = authHeader.replace("Bearer ", "");
    if (!idToken) {
      return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    }

    const decoded = await adminAuth().verifyIdToken(idToken);
    const { chatId, botToken } = await req.json();

    if (!chatId || !botToken) {
      return NextResponse.json({ error: "chatId and botToken are required." }, { status: 400 });
    }

    // Confirms the token is real and grabs the bot's @username to show in the UI.
    const bot = await telegramGetMe(botToken);

    const origin = req.nextUrl.origin;
    const webhookUrl = `${origin}/api/telegram/webhook/${decoded.uid}/${chatId}`;
    await telegramSetWebhook(botToken, webhookUrl);

    const chatRef = adminDb().collection("users").doc(decoded.uid).collection("chats").doc(chatId);
    await chatRef.set(
      {
        telegram: {
          botToken,
          botUsername: bot.username,
          connectedAt: new Date().toISOString(),
        },
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, botUsername: bot.username });
  } catch (err) {
    console.error("[api/telegram/setup POST]", err);
    const message = err instanceof Error ? err.message : "Failed to connect Telegram.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const idToken = authHeader.replace("Bearer ", "");
    if (!idToken) {
      return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    }
    const decoded = await adminAuth().verifyIdToken(idToken);
    const { chatId, botToken } = await req.json();
    if (!chatId) {
      return NextResponse.json({ error: "chatId is required." }, { status: 400 });
    }

    if (botToken) {
      // Best-effort — clearing the webhook isn't critical if this fails.
      await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`).catch(() => null);
    }

    const chatRef = adminDb().collection("users").doc(decoded.uid).collection("chats").doc(chatId);
    await chatRef.set({ telegram: null }, { merge: true });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/telegram/setup DELETE]", err);
    const message = err instanceof Error ? err.message : "Failed to disconnect Telegram.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}