// lib/missionEngine.ts
// Executes a Mission as waves: every subtask whose dependencies are all
// "done" is ready; all currently-ready subtasks run CONCURRENTLY (capped
// at MAX_CONCURRENCY so a mission can't hammer the browser/computer/rate
// limits), then the next wave is computed. This is what makes
// independent work (e.g. researching 5 companies) genuinely parallel
// instead of one-at-a-time — while dependent work (a report that needs
// those 5 results) correctly waits.

import { sendChatMessage } from "@/lib/chatClient";
import { decideAutoTools } from "@/lib/autoTools";
import { startBrowserSession, stopBrowserSession, runBrowserTask } from "@/lib/browserClient";
import { startComputerSession, stopComputerSession, runComputerTask } from "@/lib/computerClient";
import { updateMission, type Mission, type MissionSubtask } from "@/lib/missions";
import { verifyTaskResult } from "@/lib/verification";
import { withRecovery } from "@/lib/recoveryEngine";

const MAX_CONCURRENCY = 3; // caps parallel browser/computer/API usage per mission

async function runOneSubtask(
  providerId: string, apiKey: string, objective: string, subtask: MissionSubtask,
  priorResults: string[], hasBrowser: boolean, hasComputer: boolean, model: string | undefined,
  onStep: (s: string) => void
): Promise<string> {
  const context = priorResults.length ? `Relevant results from finished subtasks:\n${priorResults.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\n` : "";
  const autoDecision = subtask.workerType === "browser" || subtask.workerType === "computer"
    ? { needsBrowser: subtask.workerType === "browser" && hasBrowser, needsComputer: subtask.workerType === "computer" && hasComputer, installSkillUrl: null, askAgentChatId: null }
    : await decideAutoTools(providerId, apiKey, subtask.description, hasBrowser, hasComputer, [], model);

  let toolNote = "";
  if (autoDecision.needsBrowser) {
    onStep(`🌐 [${subtask.id}] Starting the browser...`);
    const { sessionId } = await startBrowserSession();
    try {
      const summary = await runBrowserTask(providerId, apiKey, sessionId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`));
      toolNote = `Used the browser: ${summary}`;
    } finally {
      await stopBrowserSession(sessionId);
    }
  } else if (autoDecision.needsComputer) {
    onStep(`🖥️ [${subtask.id}] Starting the computer...`);
    const { sandboxId } = await startComputerSession();
    try {
      const summary = await runComputerTask(providerId, apiKey, sandboxId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`));
      toolNote = `Used the computer: ${summary}`;
    } finally {
      await stopComputerSession(sandboxId);
    }
  }

  const prompt = `You're the "${subtask.workerType}" specialist on a team working toward this objective: "${objective}"\n\n${context}Your subtask: "${subtask.description}"${
    toolNote ? `\n\n${toolNote}` : ""
  }\n\nGive a concise result for your subtask.`;
  const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
  return text;
}

async function runAndVerify(
  uid: string, missionId: string, providerId: string, apiKey: string, objective: string,
  subtask: MissionSubtask, priorResults: string[], hasBrowser: boolean, hasComputer: boolean,
  model: string | undefined, onStep: (s: string) => void
): Promise<MissionSubtask> {
  const recovery = await withRecovery(`mission:${missionId}:${subtask.id}`, async () => {
    const outcome = await runOneSubtask(providerId, apiKey, objective, subtask, priorResults, hasBrowser, hasComputer, model, onStep);
    const verdict = await verifyTaskResult(providerId, apiKey, subtask.description, outcome, model);
    if (!verdict.verified) throw new Error(verdict.reason || "Verification failed.");
    return outcome;
  });

  return recovery.ok
    ? { ...subtask, status: "done", result: recovery.value, attempts: recovery.attempts }
    : { ...subtask, status: "failed", error: `${recovery.error.category}: ${recovery.rawMessage}`, attempts: recovery.attempts };
}

function findReadySubtasks(subtasks: MissionSubtask[]): MissionSubtask[] {
  const doneIds = new Set(subtasks.filter((s) => s.status === "done" || s.status === "skipped").map((s) => s.id));
  return subtasks.filter((s) => s.status === "pending" && s.dependsOn.every((dep) => doneIds.has(dep)));
}

export async function runMission(
  uid: string, providerId: string, apiKey: string, mission: Mission,
  hasBrowser: boolean, hasComputer: boolean, model: string | undefined,
  onUpdate: (mission: Mission) => void, onStep: (s: string) => void,
  isCancelled: () => boolean
): Promise<Mission> {
  let current: Mission = { ...mission, subtasks: [...mission.subtasks] };

  const stillPending = () => current.subtasks.some((s) => s.status === "pending");

  while (stillPending()) {
    if (isCancelled()) {
      current = { ...current, status: "cancelled" };
      onUpdate(current);
      await updateMission(uid, mission.id, { status: "cancelled" });
      return current;
    }

    let ready = findReadySubtasks(current.subtasks);

    // A subtask blocked on a FAILED dependency can never become ready —
    // mark it skipped so the mission doesn't stall forever on it.
    if (ready.length === 0) {
      const failedIds = new Set(current.subtasks.filter((s) => s.status === "failed").map((s) => s.id));
      const blocked = current.subtasks.filter((s) => s.status === "pending" && s.dependsOn.some((d) => failedIds.has(d)));
      if (blocked.length > 0) {
        current.subtasks = current.subtasks.map((s) =>
          blocked.some((b) => b.id === s.id) ? { ...s, status: "skipped", error: "Skipped — a required dependency failed." } : s
        );
        onUpdate(current);
        await updateMission(uid, mission.id, { subtasks: current.subtasks });
        continue;
      }
      // Nothing ready and nothing blocked-by-failure — a genuine cycle;
      // run whatever's left sequentially as a safe fallback.
      ready = current.subtasks.filter((s) => s.status === "pending").slice(0, 1);
      if (ready.length === 0) break;
    }

    const wave = ready.slice(0, MAX_CONCURRENCY);
    onStep(
      wave.length > 1
        ? `Running ${wave.length} subtasks in parallel: ${wave.map((s) => s.description).join(" · ")}`
        : `Step: ${wave[0].description}`
    );

    current.subtasks = current.subtasks.map((s) => (wave.some((w) => w.id === s.id) ? { ...s, status: "running" } : s));
    onUpdate(current);
    await updateMission(uid, mission.id, { subtasks: current.subtasks, status: "running" });

    const priorResults = current.subtasks.filter((s) => s.status === "done" && s.result).map((s) => s.result!);

    const results = await Promise.all(
      wave.map((s) => runAndVerify(uid, mission.id, providerId, apiKey, current.objective, s, priorResults, hasBrowser, hasComputer, model, onStep))
    );

    current.subtasks = current.subtasks.map((s) => results.find((r) => r.id === s.id) || s);
    onUpdate(current);
    await updateMission(uid, mission.id, { subtasks: current.subtasks });
  }

  const anyFailed = current.subtasks.some((s) => s.status === "failed");
  const finalStatus = current.status === "cancelled" ? "cancelled" : anyFailed ? "failed" : "completed";

  const summaryPrompt = `Objective: "${current.objective}"\n\nResults:\n${current.subtasks
    .map((s) => `- [${s.status}/${s.workerType}] ${s.description}${s.result ? `: ${s.result.slice(0, 300)}` : s.error ? ` (${s.error})` : ""}`)
    .join("\n")}\n\nWrite a short final summary for the user — what was accomplished, what failed if anything, and what they might want to do next.`;
  const { text: summary } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: summaryPrompt }] });

  current = { ...current, status: finalStatus, summary };
  onUpdate(current);
  await updateMission(uid, mission.id, { status: finalStatus, summary });
  return current;
}