// lib/agentMemory.ts
// Two things now, per user per specialist agent: durable one-line "lessons"
// from past tasks (as before, capped), and durable "facts" — small, reusable
// pieces of context the agent figured out about the user's business or
// preferences (a palette, a target audience, a tone) that keep applying
// without Business DNA being filled in by hand. Both are re-read every time
// that specialist works, which is what makes it feel like it's actually
// learning instead of starting fresh every chat.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { sendChatMessage } from "@/lib/chatClient";
import { parseFirstJson } from "@/lib/agentJson";

const MAX_LESSONS = 20;
const MAX_FACTS = 40;

export type AgentFact = { key: string; value: string; updatedAt: number };
export type AgentMemory = { lessons: string[]; facts: AgentFact[] };

export async function getAgentMemory(uid: string, agentId: string): Promise<AgentMemory> {
  const ref = doc(db, "users", uid, "agentMemory", agentId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { lessons: [], facts: [] };
  const data = snap.data();
  return { lessons: (data.lessons as string[]) || [], facts: (data.facts as AgentFact[]) || [] };
}

/** Back-compat for older call sites that only wanted the lessons list. */
export async function getAgentLessons(uid: string, agentId: string): Promise<string[]> {
  return (await getAgentMemory(uid, agentId)).lessons;
}

export function buildLessonsContext(memory: AgentMemory | string[]): string {
  const lessons = Array.isArray(memory) ? memory : memory.lessons;
  const facts = Array.isArray(memory) ? [] : memory.facts;
  const parts: string[] = [];
  if (facts.length) {
    parts.push(`Things you've learned about this user/business — apply them without being asked again:\n${facts.map((f) => `- ${f.key}: ${f.value}`).join("\n")}`);
  }
  if (lessons.length) {
    parts.push(`Lessons you've picked up from past tasks like this one — apply them:\n${lessons.map((l) => `- ${l}`).join("\n")}`);
  }
  return parts.join("\n\n");
}

async function saveMemory(uid: string, agentId: string, memory: AgentMemory) {
  const ref = doc(db, "users", uid, "agentMemory", agentId);
  await setDoc(ref, { lessons: memory.lessons.slice(-MAX_LESSONS), facts: memory.facts.slice(-MAX_FACTS) });
}

function upsertFacts(existing: AgentFact[], incoming: { key: string; value: string }[]): AgentFact[] {
  const now = Date.now();
  const map = new Map(existing.map((f) => [f.key.toLowerCase(), f]));
  for (const f of incoming) {
    if (!f?.key || !f?.value) continue;
    map.set(f.key.toLowerCase(), { key: f.key.slice(0, 60), value: f.value.slice(0, 300), updatedAt: now });
  }
  return Array.from(map.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

/** After a task completes, asks the AI to reflect: one reusable lesson (or
 * none), plus any durable facts worth remembering about the user/business.
 * Self-improving in the concrete sense that both feed straight back into
 * every future system prompt for this specialist. */
export async function reflectAndLearn(
  uid: string,
  agentId: string,
  providerId: string,
  apiKey: string,
  task: string,
  reply: string,
  model?: string
): Promise<void> {
  const prompt = `Task: "${task}"\nYour reply: "${reply.slice(0, 1200)}"\n\nReflect in ONE JSON object:\n{"lesson": "one short, concrete, reusable sentence for handling a similar task better next time, or null if there's nothing worth remembering", "facts": [{"key": "short label", "value": "the durable fact, e.g. a palette, audience, tone, policy"}]}\nOnly include facts that would still be true and useful weeks from now — skip anything one-off or already obvious. Reply with ONLY the JSON.`;

  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    const parsed = parseFirstJson<{ lesson?: string | null; facts?: { key: string; value: string }[] }>(text);
    if (!parsed) return;

    const current = await getAgentMemory(uid, agentId);
    let lessons = current.lessons;
    const lesson = typeof parsed.lesson === "string" ? parsed.lesson.trim() : "";
    if (lesson && !/^none$/i.test(lesson) && !lessons.some((l) => l.toLowerCase() === lesson.toLowerCase())) {
      lessons = [...lessons, lesson];
    }
    const facts = Array.isArray(parsed.facts) ? upsertFacts(current.facts, parsed.facts) : current.facts;

    if (lessons !== current.lessons || facts !== current.facts) {
      await saveMemory(uid, agentId, { lessons, facts });
    }
  } catch {
    // Learning is a nice-to-have — never let it break the actual reply.
  }
}