// Mission execution runtime.
// Design goal: planning is control-plane metadata; workers are the execution
// plane. A weak/failed planner or verifier must not silently prevent useful
// work. The runtime keeps state durable, retries transient failures, executes
// independent steps concurrently, and only gates true downstream dependencies.

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { decideAutoTools } from "@/lib/autoTools";
import { startBrowserSession, stopBrowserSession, runBrowserTask } from "@/lib/browserClient";
import { startComputerSession, stopComputerSession, runComputerTask } from "@/lib/computerClient";
import { updateMission, type Mission, type MissionSubtask, type WorkerType } from "@/lib/missions";
import { verifyTaskResult } from "@/lib/verification";
import { withRecovery } from "@/lib/recoveryEngine";
import { getAgentById } from "@/lib/agents";

const MAX_CONCURRENCY = 3;
const MAX_STEP_ATTEMPTS = 3;

const WORKER_LABEL: Record<WorkerType, string> = {
  planner: "🧭 Planner", researcher: "🔎 Researcher", browser: "🌐 Browser", computer: "🖥️ Computer",
  coder: "💻 Coder", data: "📊 Data", file: "📁 File", qa: "✅ QA", writer: "✍️ Writer", security: "🛡️ Security",
};
const WORKER_COLOR: Record<WorkerType, string> = {
  planner: "#8A8578", researcher: "#20808D", browser: "#5A6B4E", computer: "#D97757",
  coder: "#4D6BFE", data: "#00A1E0", file: "#8A8578", qa: "#BF5F3F", writer: "#5A6B4E", security: "#6467F2",
};

function looksLikeRealCode(output: string): boolean {
  return /```[a-z0-9+#.-]*\s*[\s\S]*?```/i.test(output) ||
    /(?:filename\s*:|<html|function\s+\w+\s*\(|import\s+.+from|const\s+\w+\s*=|class\s+\w+)/i.test(output);
}

async function runOneSubtask(
  providerId: string, apiKey: string, objective: string, subtask: MissionSubtask,
  priorResults: string[], hasBrowser: boolean, hasComputer: boolean, model: string | undefined,
  onStep: (s: string) => void
): Promise<string> {
  const context = priorResults.length
    ? `Useful outputs from completed workers:\n${priorResults.map((r, i) => `--- Result ${i + 1} ---\n${r.slice(0, 6000)}`).join("\n")}\n\n`
    : "";

  if (subtask.workerType === "browser") {
    if (!hasBrowser) throw new Error("NO_BROWSER: Browser isn't connected. Add a Browserless API key in Settings → Integrations.");
    onStep(`🌐 [${subtask.id}] Starting the browser...`);
    const { sessionId } = await startBrowserSession();
    try {
      return await runBrowserTask(providerId, apiKey, sessionId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`));
    } finally {
      await stopBrowserSession(sessionId).catch(() => undefined);
    }
  }

  if (subtask.workerType === "computer") {
    if (!hasComputer) throw new Error("NO_COMPUTER: Cloud computer isn't connected. Add a Daytona API key in Settings → Integrations.");
    onStep(`🖥️ [${subtask.id}] Starting the computer...`);
    const { sandboxId } = await startComputerSession();
    try {
      return await runComputerTask(providerId, apiKey, sandboxId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`));
    } finally {
      await stopComputerSession(sandboxId).catch(() => undefined);
    }
  }

  // Let a worker request a real tool when its task needs one. Tool availability
  // is checked before execution; there is no silent "I did it" fallback.
  const autoDecision = await decideAutoTools(providerId, apiKey, subtask.description, hasBrowser, hasComputer, [], model);
  let toolNote = "";
  if (autoDecision.needsBrowser) {
    if (!hasBrowser) throw new Error("NO_BROWSER: This step needs real web access. Add a Browserless API key in Settings → Integrations.");
    onStep(`🌐 [${subtask.id}] Worker requested the browser...`);
    const { sessionId } = await startBrowserSession();
    try {
      const result = await runBrowserTask(providerId, apiKey, sessionId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`));
      toolNote = `Real browser result:\n${result}`;
    } finally {
      await stopBrowserSession(sessionId).catch(() => undefined);
    }
  } else if (autoDecision.needsComputer) {
    if (!hasComputer) throw new Error("NO_COMPUTER: This step needs a real cloud computer. Add a Daytona API key in Settings → Integrations.");
    onStep(`🖥️ [${subtask.id}] Worker requested the computer...`);
    const { sandboxId } = await startComputerSession();
    try {
      const result = await runComputerTask(providerId, apiKey, sandboxId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`));
      toolNote = `Real computer result:\n${result}`;
    } finally {
      await stopComputerSession(sandboxId).catch(() => undefined);
    }
  }

  const isCoder = subtask.workerType === "coder";
  const isQa = subtask.workerType === "qa";
  const prompt = `${isCoder ? `You are the implementation engineer. Actually produce the requested code/files. Do not merely say that you completed it. For a project, output complete files with filename comments so the app can extract them.` : isQa ? `You are the verification/fix engineer. Inspect the supplied work against the objective. If anything is missing or incorrect, provide the concrete corrected code/output, not just a critique.` : `You are the ${subtask.workerType} specialist. Perform your part of the task and return concrete results.`}

Overall objective: "${objective}"

${context}${toolNote ? `${toolNote}\n\n` : ""}Your current task: "${subtask.description}"

Return the actual work/result. Never claim success without producing the useful artifact or concrete evidence. If a previous result is incomplete, repair it instead of stopping.`;

  const { text } = await sendChatMessage({
    providerId, apiKey, model,
    messages: [{ role: "user", content: prompt }],
    systemPrompt: isCoder ? getAgentById("developer").systemPrompt : undefined,
  });

  if (!text?.trim()) throw new Error("Worker returned an empty result.");
  if (isCoder && !looksLikeRealCode(text)) throw new Error("Coder returned no concrete code/artifact. Retry with an implementation-first prompt.");
  return text;
}

async function runAndVerify(
  uid: string, missionId: string, providerId: string, apiKey: string, objective: string,
  subtask: MissionSubtask, priorResults: string[], hasBrowser: boolean, hasComputer: boolean,
  model: string | undefined, onStep: (s: string) => void
): Promise<MissionSubtask> {
  const recovery = await withRecovery(
    `mission:${missionId}:${subtask.id}`,
    async () => {
      const outcome = await runOneSubtask(providerId, apiKey, objective, subtask, priorResults, hasBrowser, hasComputer, model, onStep);

      // Do not use an LLM as a hard gate for ordinary reasoning/coding output.
      // This was the source of the "declaration of completion" dead-end:
      // verifier disagreement turned a useful worker result into a failed
      // dependency and skipped every downstream step. Real external-tool
      // workers are verified because they have an observable side effect.
      if (subtask.workerType === "browser" || subtask.workerType === "computer") {
        const verdict = await verifyTaskResult(providerId, apiKey, subtask.description, outcome, model);
        if (!verdict.verified) throw new Error(verdict.reason || "External-tool result could not be verified.");
      }
      return outcome;
    },
    MAX_STEP_ATTEMPTS
  );

  if (recovery.ok) return { ...subtask, status: "done", result: recovery.value, attempts: recovery.attempts };
  const cleanError = recovery.rawMessage.replace(/^NO_(BROWSER|COMPUTER):\s*/, "");
  return { ...subtask, status: "failed", error: cleanError, attempts: recovery.attempts };
}

function subtaskToMessage(s: MissionSubtask): ChatMessage {
  const label = `${WORKER_LABEL[s.workerType]} — ${s.description}`;
  return s.status === "done"
    ? { role: "assistant", content: s.result || "(worker completed without text)", agentName: label, agentColor: WORKER_COLOR[s.workerType] }
    : { role: "assistant", content: `⚠️ Couldn't complete this step: ${s.error}`, agentName: label, agentColor: "#BF5F3F" };
}

function findReadySubtasks(subtasks: MissionSubtask[]): MissionSubtask[] {
  const doneIds = new Set(subtasks.filter((s) => s.status === "done").map((s) => s.id));
  return subtasks.filter((s) => s.status === "pending" && s.dependsOn.every((dep) => doneIds.has(dep)));
}

export async function runMission(
  uid: string, providerId: string, apiKey: string, mission: Mission,
  hasBrowser: boolean, hasComputer: boolean, model: string | undefined,
  onUpdate: (mission: Mission) => void, onStep: (s: string) => void,
  isCancelled: () => boolean,
  onSubtaskMessage: (msg: ChatMessage) => void | Promise<void>
): Promise<Mission> {
  let current: Mission = { ...mission, subtasks: mission.subtasks.map((s) => ({ ...s })) };

  // Repair old missions that still contain a planner subtask. Planner is now
  // metadata only; keeping it as a blocking worker would reproduce the bug.
  const legacyPlanner = current.subtasks.find((s) => s.workerType === "planner");
  if (legacyPlanner) {
    const replacement = { ...legacyPlanner, workerType: "coder" as WorkerType,
      description: `Execute the objective directly: ${legacyPlanner.description}` };
    current = { ...current, subtasks: current.subtasks.map((s) => s.id === legacyPlanner.id ? replacement : s) };
    onUpdate(current);
    await updateMission(uid, mission.id, { subtasks: current.subtasks });
  }

  while (current.subtasks.some((s) => s.status === "pending")) {
    if (isCancelled()) {
      current = { ...current, status: "cancelled" };
      onUpdate(current);
      await updateMission(uid, mission.id, { status: "cancelled" });
      return current;
    }

    let ready = findReadySubtasks(current.subtasks);
    if (ready.length === 0) {
      const blocked = current.subtasks.filter((s) => s.status === "pending");
      if (blocked.length) {
        // A malformed/cyclic dependency graph should not hang forever. Run one
        // remaining task with the available context, like an agent recovery turn.
        ready = [blocked[0]];
      } else break;
    }

    const wave = ready.slice(0, MAX_CONCURRENCY);
    onStep(wave.length > 1 ? `Running ${wave.length} workers in parallel...` : `Step: ${wave[0].description}`);

    current = {
      ...current,
      status: "running",
      subtasks: current.subtasks.map((s) => wave.some((w) => w.id === s.id) ? { ...s, status: "running" } : s),
    };
    onUpdate(current);
    await updateMission(uid, mission.id, { status: "running", subtasks: current.subtasks });

    const priorResults = current.subtasks.filter((s) => s.status === "done" && s.result).map((s) => s.result!);

    // IMPORTANT: never mutate `current` from inside Promise.all. The old
    // implementation could race parallel workers and overwrite a completed
    // sibling with a stale subtasks array in Firestore/UI.
    const results = await Promise.all(
      wave.map((s) => runAndVerify(uid, mission.id, providerId, apiKey, current.objective, s, priorResults, hasBrowser, hasComputer, model, onStep))
    );

    const resultMap = new Map(results.map((r) => [r.id, r]));
    current = { ...current, subtasks: current.subtasks.map((s) => resultMap.get(s.id) || s) };
    onUpdate(current);
    await updateMission(uid, mission.id, { subtasks: current.subtasks });
    for (const result of results) await onSubtaskMessage(subtaskToMessage(result));
  }

  const anyFailed = current.subtasks.some((s) => s.status === "failed");
  const finalStatus = current.status === "cancelled" ? "cancelled" : anyFailed ? "failed" : "completed";

  let summary = "Mission finished.";
  try {
    const summaryPrompt = `Objective: "${current.objective}"\n\nWorker results:\n${current.subtasks
      .map((s) => `- [${s.status}/${s.workerType}] ${s.description}${s.result ? `: ${s.result.slice(0, 500)}` : s.error ? ` (${s.error})` : ""}`)
      .join("\n")}\n\nGive a concise factual summary. Do not claim a file, email, browser action, or deployment succeeded unless the worker result contains evidence of it.`;
    const response = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: summaryPrompt }] });
    summary = response.text || summary;
  } catch {
    // A final summarization failure must not erase the actual worker results.
    summary = current.subtasks.map((s) => `${s.status}: ${s.description}`).join("\n");
  }

  current = { ...current, status: finalStatus, summary };
  onUpdate(current);
  await updateMission(uid, mission.id, { status: finalStatus, summary });
  return current;
}