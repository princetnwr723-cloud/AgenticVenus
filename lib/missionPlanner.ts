// lib/missionPlanner.ts
import { sendChatMessage } from "@/lib/chatClient";
import type { SubtaskDraft, WorkerType } from "@/lib/missions";

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

const WORKER_TYPES: WorkerType[] = ["planner", "researcher", "browser", "computer", "coder", "data", "file", "qa", "writer", "security"];

export type MissionDecision = { isMission: boolean; subtasks: SubtaskDraft[] };

/** Decides whether a request is multi-step, and if so, breaks it into a
 * real dependency graph — which subtasks are independent (can run in
 * parallel) vs. which must wait on another subtask's output — plus
 * which kind of specialist worker best fits each one. */
export async function decideMissionIntent(
  providerId: string, apiKey: string, task: string, model?: string
): Promise<MissionDecision> {
  const prompt = `Decide if this request is a genuinely multi-step objective worth tracking as subtasks — vs. something answerable in a single response.

Request: "${task}"

Multi-step examples: "research 20 companies and summarize them", "build and deploy a full website", "find leads and organize them into a list".
NOT multi-step: a question, a simple chat message, a request to continue something.

If it IS multi-step, break it into 3-8 concrete subtasks AND identify real dependencies — most research/data-gathering subtasks on DIFFERENT targets (e.g. "research company A" and "research company B") are INDEPENDENT and should have no dependency on each other; a subtask that needs another's output (e.g. "compile results into a report" needs the research subtasks first) DOES depend on those. Don't invent unnecessary dependencies — default to independent unless one genuinely needs another's output.

Available worker types: ${WORKER_TYPES.join(", ")}.

Reply with ONLY raw JSON:
{"isMission": boolean, "subtasks": [{"description": "...", "dependsOnIndexes": [0-based indexes of subtasks in THIS array that must finish first, or []], "workerType": "one of the worker types"}]}`;

  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    const parsed = JSON.parse(extractJson(text));
    const subtasks: SubtaskDraft[] = Array.isArray(parsed.subtasks)
      ? parsed.subtasks.slice(0, 10).map((s: any) => ({
          description: String(s.description || "").slice(0, 300),
          dependsOnIndexes: Array.isArray(s.dependsOnIndexes) ? s.dependsOnIndexes.filter((n: any) => Number.isInteger(n)) : [],
          workerType: WORKER_TYPES.includes(s.workerType) ? s.workerType : "planner",
        }))
      : [];
    return { isMission: !!parsed.isMission && subtasks.length >= 2, subtasks };
  } catch {
    return { isMission: false, subtasks: [] };
  }
}

export async function decideContinueIntent(
  providerId: string, apiKey: string, task: string, model?: string
): Promise<{ wantsContinue: boolean }> {
  const prompt = `Does this message ask to resume/continue a previous task rather than start something new? Message: "${task}"\nReply with ONLY raw JSON: {"wantsContinue": boolean}`;
  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    return { wantsContinue: !!JSON.parse(extractJson(text)).wantsContinue };
  } catch {
    return { wantsContinue: /\b(continue|resume|keep going|carry on|finish (it|that|yesterday))\b/i.test(task) };
  }
}