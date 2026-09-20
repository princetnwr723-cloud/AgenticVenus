// Mission planning is intentionally lightweight. The planner creates a useful
// execution graph, but it is NOT itself an execution step. A failed planning
// inference must never become a blocker for the real agent/tool workers.
import { sendChatMessage } from "@/lib/chatClient";
import type { SubtaskDraft, WorkerType } from "@/lib/missions";

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

const WORKER_TYPES: WorkerType[] = ["researcher", "browser", "computer", "coder", "data", "file", "qa", "writer", "security"];

export type MissionDecision = { isMission: boolean; subtasks: SubtaskDraft[] };

function heuristicMission(task: string): MissionDecision {
  const lower = task.toLowerCase();
  const build = /\b(build|create|make|develop|code|implement|clone|website|app|game|script|software)\b/.test(lower);
  const browse = /\b(search|browse|visit|find online|scrape|research|website|google)\b/.test(lower);
  const email = /\b(email|send.*mail|mail)\b/.test(lower);
  const deploy = /\b(deploy|publish|ship|launch)\b/.test(lower);
  const multi = build || browse || email || deploy || /\band\b|then|after|multiple|list|report/.test(lower);
  if (!multi) return { isMission: false, subtasks: [] };

  if (build) {
    return {
      isMission: true,
      subtasks: [
        { description: `Implement the requested project end-to-end: ${task}. Create real files/code and make the result runnable.`, dependsOnIndexes: [], workerType: "coder" },
        { description: `Run the project, exercise the main user flow, inspect errors, and fix any issues. Verify the requested result is actually usable.`, dependsOnIndexes: [0], workerType: "qa" },
      ],
    };
  }

  if (browse) {
    return {
      isMission: true,
      subtasks: [
        { description: `Use the real browser to complete the requested web research/task: ${task}. Return the concrete results and sources/actions performed.`, dependsOnIndexes: [], workerType: "browser" },
        { description: `Review the browser results, check for missing or contradictory information, and produce the requested final output.`, dependsOnIndexes: [0], workerType: "researcher" },
      ],
    };
  }

  if (email) {
    return {
      isMission: true,
      subtasks: [
        { description: `Complete the requested email task for real using the connected email tool: ${task}.`, dependsOnIndexes: [], workerType: "writer" },
        { description: `Verify that the email action actually succeeded and report the real outcome.`, dependsOnIndexes: [0], workerType: "qa" },
      ],
    };
  }

  return {
    isMission: true,
    subtasks: [
      { description: `Complete the first concrete part of this objective: ${task}`, dependsOnIndexes: [], workerType: "coder" },
      { description: `Review the work from the previous step, fix problems, and produce the requested final result.`, dependsOnIndexes: [0], workerType: "qa" },
    ],
  };
}

/**
 * Creates a dependency graph. Planner is a control-plane concept, not a
 * worker. This mirrors persistent agent runtimes: inference decides what to
 * do, then the selected tool/worker performs it; planning failure is not a
 * reason to skip the actual work.
 */
export async function decideMissionIntent(
  providerId: string, apiKey: string, task: string, model?: string
): Promise<MissionDecision> {
  const fallback = heuristicMission(task);
  const prompt = `You are the mission orchestrator. Turn this user request into the SMALLEST useful execution graph. Do not create a planner task. Every task must produce a real action or artifact.

Request: "${task}"

Rules:
- For build/create/code requests, make the first step the actual coder/implementation worker. Do NOT make architecture/planning a prerequisite.
- For browser requests, use browser as the first worker.
- For computer/desktop requests, use computer as the first worker.
- For email/plugin actions, make the real action the first worker.
- QA/testing comes after implementation and may fix/retry failures.
- Never add a dependency merely for documentation or planning.
- 2-5 subtasks maximum.
- If a single worker can finish the task, return one subtask.

Worker types: ${WORKER_TYPES.join(", ")}

Reply ONLY JSON: {"isMission":true,"subtasks":[{"description":"...","dependsOnIndexes":[],"workerType":"coder"}]}`;

  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    const parsed = JSON.parse(extractJson(text));
    const raw = Array.isArray(parsed.subtasks) ? parsed.subtasks : [];
    const subtasks: SubtaskDraft[] = raw.slice(0, 5).map((s: any) => ({
      description: String(s.description || "").trim().slice(0, 500),
      dependsOnIndexes: Array.isArray(s.dependsOnIndexes)
        ? s.dependsOnIndexes.filter((n: any) => Number.isInteger(n) && n >= 0 && n < raw.length)
        : [],
      workerType: WORKER_TYPES.includes(s.workerType) ? s.workerType : "coder",
    })).filter((s: SubtaskDraft) => s.description.length > 0);

    // Sanitize cycles/self dependencies. A malformed model graph should not
    // deadlock the executor; falling back is safer than silently stalling.
    const valid = subtasks.length > 0 && subtasks.every((s, i) => !s.dependsOnIndexes.includes(i));
    if (valid && parsed.isMission) return { isMission: true, subtasks };
  } catch {
    // Deterministic fallback below. Planning inference is optional.
  }
  return fallback;
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