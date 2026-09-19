// lib/missionPlanner.ts
import { sendChatMessage } from "@/lib/chatClient";

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export type MissionDecision = { isMission: boolean; subtasks: string[] };

/** Decides whether a request is genuinely multi-step (worth tracking as
 * a Mission with checkpointed subtasks) vs. a normal one-shot message. */
export async function decideMissionIntent(
  providerId: string, apiKey: string, task: string, model?: string
): Promise<MissionDecision> {
  const prompt = `Decide if this request is a genuinely multi-step objective that benefits from being broken into tracked subtasks executed one by one — vs. something answerable in a single response.

Request: "${task}"

Multi-step examples: "research 20 companies and summarize them", "build and deploy a full website", "find leads and organize them into a list".
NOT multi-step: a question, a simple chat message, a request to continue something (handled separately).

Reply with ONLY raw JSON: {"isMission": boolean, "subtasks": ["short subtask 1", "short subtask 2", ...]}
If isMission is false, subtasks must be an empty array. Keep subtasks to 3-8 concrete steps.`;

  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    const parsed = JSON.parse(extractJson(text));
    return {
      isMission: !!parsed.isMission && Array.isArray(parsed.subtasks) && parsed.subtasks.length >= 2,
      subtasks: Array.isArray(parsed.subtasks) ? parsed.subtasks.slice(0, 10) : [],
    };
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