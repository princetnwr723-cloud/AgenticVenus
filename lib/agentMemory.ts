// lib/agentMemory.ts
// This is what makes each agent genuinely self-improving by default: after
// finishing a task, it briefly reflects on what would help it do a
// similar task better next time, and that lesson gets folded into its
// system prompt for every future task — per agent persona, per user.
// It's real accumulated context, not a marketing claim: you can watch
// the lessons list grow in Firestore under users/{uid}/agentMemory.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { sendChatMessage } from "@/lib/chatClient";

const MAX_LESSONS = 20;

export async function getAgentLessons(uid: string, agentId: string): Promise<string[]> {
  const ref = doc(db, "users", uid, "agentMemory", agentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  return (snap.data().lessons as string[]) || [];
}

export function buildLessonsContext(lessons: string[]): string {
  if (lessons.length === 0) return "";
  return `Lessons you've picked up from past tasks like this one — apply them:\n${lessons
    .map((l) => `- ${l}`)
    .join("\n")}`;
}

async function saveLessons(uid: string, agentId: string, lessons: string[]) {
  const ref = doc(db, "users", uid, "agentMemory", agentId);
  // Keep only the most recent MAX_LESSONS so this can't grow forever.
  await setDoc(ref, { lessons: lessons.slice(-MAX_LESSONS) });
}

/** After a task completes, asks the AI to reflect in one sentence on
 * what would help handle a similar task better next time. Skips saving
 * anything if there's genuinely nothing new to learn. */
export async function reflectAndLearn(
  uid: string,
  agentId: string,
  providerId: string,
  apiKey: string,
  task: string,
  reply: string,
  model?: string
): Promise<void> {
  const prompt = `Task: "${task}"\nYour reply: "${reply.slice(0, 800)}"\n\nIn ONE short, concrete, reusable sentence, what would help you handle a similar task better next time (a preference, a format, a detail to remember, a mistake to avoid)? If there's genuinely nothing worth remembering from this exchange, reply with exactly: NONE`;

  try {
    const { text } = await sendChatMessage({
      providerId,
      apiKey,
      messages: [{ role: "user", content: prompt }],
      model,
    });
    const lesson = text.trim();
    if (!lesson || /^none\.?$/i.test(lesson)) return;

    const existing = await getAgentLessons(uid, agentId);
    if (existing.some((l) => l.toLowerCase() === lesson.toLowerCase())) return;
    await saveLessons(uid, agentId, [...existing, lesson]);
  } catch {
    // Learning is a nice-to-have — never let it break the actual reply.
  }
}