// lib/scheduler.ts
// Lets a user (or the boss agent, automatically) schedule a message to be
// sent to their agent at a future time — once, or every day. Tasks are
// stored in Firestore. Because this project has no always-on server yet,
// due tasks are checked and run whenever the workspace is open (see
// runDueTasks, called from the home page on load and on an interval).
// For true background execution while the app is closed, this same logic
// would move into a Vercel Cron job hitting a server route with the
// Firebase Admin SDK — see README.
//
// If a task was created from a specific conversation, its result is
// written back into that same chat (not just the Scheduler panel) so the
// user sees it appear where they asked for it.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { sendChatMessage } from "@/lib/chatClient";
import { getChat, saveChatMessages } from "@/lib/chats";

export type Recurrence = "once" | "hourly" | "daily";

export type ScheduledTask = {
  id: string;
  message: string;
  runAt: Timestamp;
  recurrence: Recurrence;
  status: "pending" | "done" | "failed";
  resultText?: string;
  chatId?: string;
  createdAt?: Timestamp;
};

export async function listScheduledTasks(uid: string): Promise<ScheduledTask[]> {
  const ref = collection(db, "users", uid, "scheduledTasks");
  const q = query(ref, orderBy("runAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, recurrence: "once", ...d.data() } as ScheduledTask));
}

export async function addScheduledTask(
  uid: string,
  message: string,
  runAt: Date,
  recurrence: Recurrence = "once",
  chatId?: string
) {
  const ref = collection(db, "users", uid, "scheduledTasks");
  await addDoc(ref, {
    message,
    runAt: Timestamp.fromDate(runAt),
    recurrence,
    status: "pending",
    createdAt: serverTimestamp(),
    ...(chatId ? { chatId } : {}),
  });
}

export async function deleteScheduledTask(uid: string, taskId: string) {
  await deleteDoc(doc(db, "users", uid, "scheduledTasks", taskId));
}

/** Given "HH:MM" (24h), returns the next Date that time occurs — today if
 * it hasn't passed yet, otherwise tomorrow. */
export function nextOccurrence(time: string): Date {
  const [h, m] = time.split(":").map((n) => parseInt(n, 10));
  const now = new Date();
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h || 0, m || 0, 0, 0);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

/** Runs any pending tasks whose time has come. Daily tasks are
 * rescheduled 24h ahead instead of being marked done. If a task has a
 * chatId, its result is appended to that chat's messages too. Returns the
 * ids of any chats that were updated, so the UI can refresh if the user
 * is currently looking at one of them. */
export async function runDueTasks(
  uid: string,
  providerId: string,
  apiKey: string,
  model?: string
): Promise<string[]> {
  const tasks = await listScheduledTasks(uid);
  const now = Date.now();
  const due = tasks.filter(
    (t) => t.status === "pending" && t.runAt.toMillis() <= now
  );

  const affectedChatIds: string[] = [];

  for (const task of due) {
    const ref = doc(db, "users", uid, "scheduledTasks", task.id);
    try {
      const { text: reply } = await sendChatMessage({
        providerId,
        apiKey,
        messages: [{ role: "user", content: task.message }],
        model,
      });

      if (task.chatId) {
        try {
          const chat = await getChat(uid, task.chatId);
          if (chat) {
            const updated = [
              ...chat.messages,
              { role: "assistant" as const, content: `⏰ Scheduled task: ${reply}` },
            ];
            await saveChatMessages(uid, task.chatId, updated, chat.agentId, chat.providerId);
            affectedChatIds.push(task.chatId);
          }
        } catch (err) {
          console.error("[scheduler] failed to write result into chat:", err);
        }
      }

      if (task.recurrence === "daily" || task.recurrence === "hourly") {
        const next = new Date(task.runAt.toMillis());
        if (task.recurrence === "hourly") next.setHours(next.getHours() + 1);
        else next.setDate(next.getDate() + 1);
        await updateDoc(ref, {
          status: "pending",
          resultText: reply,
          runAt: Timestamp.fromDate(next),
        });
      } else {
        await updateDoc(ref, { status: "done", resultText: reply });
      }
    } catch (err) {
      await updateDoc(ref, {
        status: "failed",
        resultText: err instanceof Error ? err.message : "Failed to run.",
      });
    }
  }
  return affectedChatIds;
}