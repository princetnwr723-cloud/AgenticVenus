// lib/missionEngine.ts
import { sendChatMessage } from "@/lib/chatClient";
import { decideAutoTools } from "@/lib/autoTools";
import { startBrowserSession, stopBrowserSession, runBrowserTask } from "@/lib/browserClient";
import { startComputerSession, stopComputerSession, runComputerTask } from "@/lib/computerClient";
import { updateMission, type Mission, type MissionSubtask } from "@/lib/missions";
import { verifyTaskResult } from "@/lib/verification";
import { withRecovery } from "@/lib/recoveryEngine";

async function runOneSubtask(
  providerId: string, apiKey: string, objective: string, subtask: MissionSubtask,
  priorResults: string[], hasBrowser: boolean, hasComputer: boolean, model: string | undefined,
  onStep: (s: string) => void
): Promise<string> {
  const context = priorResults.length ? `Progress so far:\n${priorResults.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\n` : "";
  const autoDecision = await decideAutoTools(providerId, apiKey, subtask.description, hasBrowser, hasComputer, [], model);

  let toolNote = "";
  if (autoDecision.needsBrowser) {
    onStep("🌐 Starting the browser for this step...");
    const { sessionId } = await startBrowserSession();
    try {
      const summary = await runBrowserTask(providerId, apiKey, sessionId, subtask.description, model, onStep);
      toolNote = `Used the browser: ${summary}`;
    } finally {
      await stopBrowserSession(sessionId);
    }
  } else if (autoDecision.needsComputer) {
    onStep("🖥️ Starting the computer for this step...");
    const { sandboxId } = await startComputerSession();
    try {
      const summary = await runComputerTask(providerId, apiKey, sandboxId, subtask.description, model, onStep);
      toolNote = `Used the computer: ${summary}`;
    } finally {
      await stopComputerSession(sandboxId);
    }
  }

  const prompt = `You're working on this larger objective: "${objective}"\n\n${context}Current subtask: "${subtask.description}"${
    toolNote ? `\n\n${toolNote}` : ""
  }\n\nGive a concise result for this subtask — what you found or did.`;
  const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
  return text;
}

export async function runMission(
  uid: string, providerId: string, apiKey: string, mission: Mission,
  hasBrowser: boolean, hasComputer: boolean, model: string | undefined,
  onUpdate: (mission: Mission) => void, onStep: (s: string) => void,
  isCancelled: () => boolean
): Promise<Mission> {
  let current: Mission = { ...mission, subtasks: [...mission.subtasks] };
  const priorResults = current.subtasks.filter((s) => s.status === "done" && s.result).map((s) => s.result!);

  for (let i = current.currentIndex; i < current.subtasks.length; i++) {
    if (isCancelled()) {
      current = { ...current, status: "cancelled" };
      onUpdate(current);
      await updateMission(uid, mission.id, { status: "cancelled" });
      return current;
    }

    const subtask = current.subtasks[i];
    if (subtask.status === "done" || subtask.status === "skipped") continue;

    current.subtasks[i] = { ...subtask, status: "running" };
    current = { ...current, currentIndex: i };
    onUpdate(current);
    await updateMission(uid, mission.id, { subtasks: current.subtasks, currentIndex: i, status: "running" });

    onStep(`Step ${i + 1}/${current.subtasks.length}: ${subtask.description}`);

    const recovery = await withRecovery(`mission:${mission.id}:${subtask.id}`, async () => {
      const outcome = await runOneSubtask(providerId, apiKey, current.objective, subtask, priorResults, hasBrowser, hasComputer, model, onStep);
      const verdict = await verifyTaskResult(providerId, apiKey, subtask.description, outcome, model);
      if (!verdict.verified) throw new Error(verdict.reason || "Verification failed.");
      return outcome;
    });

    current.subtasks[i] = recovery.ok
      ? { ...subtask, status: "done", result: recovery.value, attempts: recovery.attempts }
      : { ...subtask, status: "failed", error: `${recovery.error.category}: ${recovery.rawMessage}`, attempts: recovery.attempts };

    if (recovery.ok) priorResults.push(recovery.value);
    onUpdate(current);
    await updateMission(uid, mission.id, { subtasks: current.subtasks });
  }

  const anyFailed = current.subtasks.some((s) => s.status === "failed");
  const finalStatus = current.status === "cancelled" ? "cancelled" : anyFailed ? "failed" : "completed";

  const summaryPrompt = `Objective: "${current.objective}"\n\nResults:\n${current.subtasks
    .map((s) => `- [${s.status}] ${s.description}${s.result ? `: ${s.result.slice(0, 300)}` : s.error ? ` (failed: ${s.error})` : ""}`)
    .join("\n")}\n\nWrite a short final summary for the user — what was accomplished, what failed if anything, and what they might want to do next.`;
  const { text: summary } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: summaryPrompt }] });

  current = { ...current, status: finalStatus, summary };
  onUpdate(current);
  await updateMission(uid, mission.id, { status: finalStatus, summary, currentIndex: current.subtasks.length });
  return current;
}