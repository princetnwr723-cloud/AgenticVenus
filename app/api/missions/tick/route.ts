// app/api/missions/tick/route.ts
// Hit by Vercel Cron (see vercel.json) to keep two things moving even when
// no browser tab is open: (1) mission "watcher" tasks (checking for email
// replies and booking meetings), and (2) the regular Scheduler's due tasks —
// previously these only ran while a tab happened to be open, which is also
// fixed here as a side effect of reusing the same sweep.
//
// Auth: either the cron secret (sweeps every user) or a signed-in user's own
// Firebase ID token (checks/runs only that user's own due items — used by
// the "Check for replies now" button, useful on Vercel plans where Cron
// can't run as often as you'd like).

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { decryptSecret } from "@/lib/secretsVault";
import { runOutreachWatch } from "@/lib/mission/watcherCore";
import { runPluginAction } from "@/lib/pluginRuntime";
import { runAutonomousReply, getBusinessDNAAdmin } from "@/lib/serverAgentTools";
import type { Mission } from "@/lib/mission/types";

export const maxDuration = 120;

const WATCH_PREFIX = "__MISSION_WATCH__:";

async function resolveProvider(uid: string): Promise<{ providerId: string; apiKey: string; model?: string } | null> {
  const snap = await adminDb().collection("users").doc(uid).collection("connections").orderBy("connectedAt", "desc").limit(1).get();
  if (snap.empty) return null;
  const d = snap.docs[0].data();
  if (!d.apiKey_enc) return null;
  return { providerId: d.providerId, apiKey: decryptSecret(d.apiKey_enc), model: d.model };
}

async function appendChatMessage(uid: string, chatId: string, content: string) {
  const chatRef = adminDb().collection("users").doc(uid).collection("chats").doc(chatId);
  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) return;
  const messages = chatSnap.data()?.messages || [];
  await chatRef.update({ messages: [...messages, { role: "assistant", content }], updatedAt: new Date() });
}

async function tickMissionWatch(uid: string, missionId: string): Promise<string> {
  const ref = adminDb().collection("users").doc(uid).collection("missions").doc(missionId);
  const snap = await ref.get();
  if (!snap.exists) return "mission not found";
  const mission = { id: snap.id, ...(snap.data() as any) } as Mission;
  const provider = await resolveProvider(uid);
  if (!provider) return "no provider connected";

  const outreachTask = mission.tasks.find((t) => t.role === "outreach");
  const context = outreachTask?.result || mission.goal;
  const result = await runOutreachWatch(provider.providerId, provider.apiKey, provider.model, (toolId, actionId, params) => runPluginAction(uid, toolId, actionId, params), context);

  const tasks = mission.tasks.map((t) => (t.role === "watcher" ? { ...t, result: `${result.summary}\n\n(checked ${new Date().toISOString()})`, updatedAt: Date.now() } : t));
  await ref.update({ tasks, updatedAt: Date.now() });

  if (result.booked > 0 && mission.chatId) {
    await appendChatMessage(uid, mission.chatId, `**Mission update — ${mission.goal}**\n\n${result.summary}`);
  }
  return `checked=${result.checked} booked=${result.booked}`;
}

async function tickRegularScheduledTask(uid: string, taskId: string, taskMessage: string, chatId?: string): Promise<void> {
  const provider = await resolveProvider(uid);
  const ref = adminDb().collection("users").doc(uid).collection("scheduledTasks").doc(taskId);
  if (!provider) {
    await ref.update({ status: "failed", resultText: "No AI provider connected." });
    return;
  }
  try {
    const dna = await getBusinessDNAAdmin(uid);
    const { text } = await runAutonomousReply(uid, provider.providerId, provider.apiKey, undefined, [{ role: "user", content: taskMessage }], dna, provider.model);
    if (chatId) await appendChatMessage(uid, chatId, `⏰ Scheduled task: ${text}`);
    await ref.update({ status: "done", resultText: text });
  } catch (err) {
    await ref.update({ status: "failed", resultText: err instanceof Error ? err.message : "Failed to run." });
  }
}

async function processDueTasksForUser(uid: string): Promise<number> {
  const now = Date.now();
  const snap = await adminDb().collection("users").doc(uid).collection("scheduledTasks").where("status", "==", "pending").get();
  let processed = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data();
    const runAt = data.runAt?.toMillis ? data.runAt.toMillis() : 0;
    if (runAt > now) continue;
    processed++;
    const message = String(data.message || "");

    if (message.startsWith(WATCH_PREFIX)) {
      const missionId = message.slice(WATCH_PREFIX.length);
      const resultNote = await tickMissionWatch(uid, missionId).catch((e) => `error: ${e instanceof Error ? e.message : String(e)}`);
      if (data.recurrence === "hourly" || data.recurrence === "daily") {
        const next = new Date(runAt);
        next.setHours(next.getHours() + (data.recurrence === "daily" ? 24 : 1));
        await docSnap.ref.update({ status: "pending", runAt: next, resultText: resultNote });
      } else {
        await docSnap.ref.update({ status: "done", resultText: resultNote });
      }
    } else {
      await tickRegularScheduledTask(uid, docSnap.id, message, data.chatId);
      if (data.recurrence === "hourly" || data.recurrence === "daily") {
        const next = new Date(runAt);
        next.setHours(next.getHours() + (data.recurrence === "daily" ? 24 : 1));
        await docSnap.ref.update({ status: "pending", runAt: next });
      }
    }
  }
  return processed;
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization") || "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "");
  const cronSecret = process.env.CRON_SECRET;

  try {
    if (cronSecret && idToken === cronSecret) {
      // Global sweep — every user with at least one pending scheduled task.
      // Requires a Firestore collection-group index on "scheduledTasks"/status
      // (Firestore/Vercel logs give a one-click link to create it the first time).
      const usersSnap = await adminDb().collectionGroup("scheduledTasks").where("status", "==", "pending").get();
      const uids = new Set<string>();
      usersSnap.forEach((d: any) => {
        const uid = d.ref.parent.parent?.id;
        if (uid) uids.add(uid);
      });
      let total = 0;
      for (const uid of uids) total += await processDueTasksForUser(uid);
      return NextResponse.json({ ok: true, usersChecked: uids.size, tasksProcessed: total });
    }

    if (idToken) {
      const decoded = await adminAuth().verifyIdToken(idToken);
      const processed = await processDueTasksForUser(decoded.uid);
      return NextResponse.json({ ok: true, tasksProcessed: processed });
    }

    return NextResponse.json({ error: "Missing auth." }, { status: 401 });
  } catch (err) {
    console.error("[api/missions/tick]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Tick failed." }, { status: 500 });
  }
}