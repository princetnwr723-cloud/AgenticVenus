// lib/scheduler.ts
// Lets a user schedule a message to be sent to their agent at a future
// time. Tasks are stored in Firestore. Because this project has no
// always-on server yet, due tasks are checked and run whenever the
// workspace is open (see runDueTasks, called from the home page on load
// and on an interval). For true background execution while the app is
// closed, this same logic would move into a Vercel Cron job hitting a
// server route with the Firebase Admin SDK — see README.

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

export type ScheduledTask = {
  id: string;
  message: string;
  runAt: Timestamp;
  status: "pending" | "done" | "failed";
  resultText?: string;
  createdAt?: Timestamp;
};

export async function listScheduledTasks(uid: string): Promise<ScheduledTask[]> {
  const ref = collection(db, "users", uid, "scheduledTasks");
  const q = query(ref, orderBy("runAt", "asc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as ScheduledTask));
}

export async function addScheduledTask(uid: string, message: string, runAt: Date) {
  const ref = collection(db, "users", uid, "scheduledTasks");
  await addDoc(ref, {
    message,
    runAt: Timestamp.fromDate(runAt),
    status: "pending",
    createdAt: serverTimestamp(),
  });
}

export async function deleteScheduledTask(uid: string, taskId: string) {
  await deleteDoc(doc(db, "users", uid, "scheduledTasks", taskId));
}

/** Runs any pending tasks whose time has come, using the given provider
 * connection. Returns how many tasks were executed, so the UI can refresh. */
export async function runDueTasks(
  uid: string,
  providerId: string,
  apiKey: string
): Promise<number> {
  const tasks = await listScheduledTasks(uid);
  const now = Date.now();
  const due = tasks.filter(
    (t) => t.status === "pending" && t.runAt.toMillis() <= now
  );

  let ran = 0;
  for (const task of due) {
    const ref = doc(db, "users", uid, "scheduledTasks", task.id);
    try {
      const reply = await sendChatMessage({
        providerId,
        apiKey,
        messages: [{ role: "user", content: task.message }],
      });
      await updateDoc(ref, { status: "done", resultText: reply });
    } catch (err) {
      await updateDoc(ref, {
        status: "failed",
        resultText: err instanceof Error ? err.message : "Failed to run.",
      });
    }
    ran += 1;
  }
  return ran;
}
