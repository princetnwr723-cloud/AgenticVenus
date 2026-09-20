// Durable mission runtime. A mission is a control-plane record; the runtime
// is the execution loop. Planning is optional metadata, never a hard gate.
// Workers perform real actions, retry recoverable failures, and downstream
// steps only wait on the steps they actually depend on.

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

function concreteEnough(output: string): boolean {
  return output.trim().length >= 80 && !/^\s*(done|completed|success|finished)\s*[.!]*\s*$/i.test(output);
}

async function runOneSubtask(
  providerId: string, apiKey: string, objective: string, subtask: MissionSubtask,
  priorResults: string[], hasBrowser: boolean, hasComputer: boolean, model: string | undefined,
  onStep: (s: string) => void
): Promise<string> {
  const context = priorResults.length
    ? `Useful outputs from completed workers:\n${priorResults.map((r, i) => `--- Result ${i + 1} ---\n${r.slice(0, 6000)}`).join("\n")}\n\n`
    : "";

  // Real browser/computer workers are first-class execution workers.
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
    onStep(`🖥️ [${subtask.id}] Starting the cloud computer...`);
    const { sandboxId } = await startComputerSession();
    try {
      return await runComputerTask(providerId, apiKey, sandboxId, `${subtask.description}\n\nIMPORTANT: this is real execution. Use the terminal/editor on the computer, create or modify the actual files, run the app/tests, and fix errors. Do not respond with a plan or pretend that work happened.`, model, (s) => onStep(`[${subtask.id}] ${s}`));
    } finally {
      await stopComputerSession(sandboxId).catch(() => undefined);
    }
  }

  // Plugin actions are real side effects. Prefer the existing plugin action
  // pipeline for email and similar tasks instead of asking an LLM to pretend
  // it sent something. The callback is optional so the runtime stays reusable.
  if (onPluginAction && /\b(gmail|send\s+(an?\s+)?email|send\s+(an?\s+)?mail|email\s+to\s+)/i.test(subtask.description)) {
    const pluginResult = await onPluginAction(subtask.description);
    if (pluginResult) {
      onStep(`🔌 [${subtask.id}] ${pluginResult}`);
      return pluginResult;
    }
  }

  // Non-specialized workers may request a real external capability. The
  // decision is made from task semantics, not from what happens to be
  // configured; missing capability becomes an explicit failure instead of a
  // hallucinated result.
  const autoDecision = await decideAutoTools(providerId, apiKey, subtask.description, hasBrowser, hasComputer, [], model);
  let toolNote = "";
  if (autoDecision.needsBrowser) {
    if (!hasBrowser) throw new Error("NO_BROWSER: This step needs real web access. Add a Browserless API key in Settings → Integrations.");
    onStep(`🌐 [${subtask.id}] Worker requested the browser...`);
    const { sessionId } = await startBrowserSession();
    try {
      toolNote = `Real browser result:\n${await runBrowserTask(providerId, apiKey, sessionId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`))}`;
    } finally {
      await stopBrowserSession(sessionId).catch(() => undefined);
    }
  } else if (autoDecision.needsComputer) {
    if (!hasComputer) throw new Error("NO_COMPUTER: This step needs a real cloud computer. Add a Daytona API key in Settings → Integrations.");
    onStep(`🖥️ [${subtask.id}] Worker requested the computer...`);
    const { sandboxId } = await startComputerSession();
    try {
      toolNote = `Real computer result:\n${await runComputerTask(providerId, apiKey, sandboxId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`))}`;
    } finally {
      await stopComputerSession(sandboxId).catch(() => undefined);
    }
  }

  const isCoder = subtask.workerType === "coder";
  const isQa = subtask.workerType === "qa";
  const prompt = `${isCoder
    ? `You are the implementation engineer. Actually produce the requested code/files. Never answer with a bare completion claim. For every project, return complete files in fenced code blocks with a filename comment on the first line so the Codespace extractor can persist them. If the project is large, prioritize a complete runnable vertical slice over an architecture essay.`
    : isQa
    ? `You are the verification and repair engineer. Inspect the supplied work against the objective. Identify concrete failures. If something can be fixed in your response, provide the corrected complete files/output. Never mark work successful merely because another agent claimed it.`
    : `You are the ${subtask.workerType} specialist. Perform your part of the task and return concrete results.`}

Overall objective: "${objective}"

${context}${toolNote ? `${toolNote}\n\n` : ""}Current task: "${subtask.description}"

Return useful work and evidence. Do not claim an external action happened unless the tool result above proves it. If a previous result is incomplete, repair it rather than stopping. For coding tasks, output actual files, not pseudo-code.`;

  const { text } = await sendChatMessage({
    providerId, apiKey, model,
    messages: [{ role: "user", content: prompt }],
    systemPrompt: isCoder ? getAgentById("developer").systemPrompt : undefined,
  });

  if (!text?.trim() || !concreteEnough(text)) throw new Error("Worker returned no concrete result. Retry with an execution-first prompt.");
  if (isCoder && !looksLikeRealCode(text)) throw new Error("Coder returned no concrete code/artifact. Retry with an implementation-first prompt.");
  return text;
}

async function runAndVerify(
  missionId: string, providerId: string, apiKey: string, objective: string,
  subtask: MissionSubtask, priorResults: string[], hasBrowser: boolean, hasComputer: boolean,
  model: string | undefined, onStep: (s: string) => void, onPluginAction?: (task: string) => Promise<string | null>
): Promise<MissionSubtask> {
  const recovery = await withRecovery(
    `mission:${missionId}:${subtask.id}`,
    async () => {
      const outcome = await runOneSubtask(providerId, apiKey, objective, subtask, priorResults, hasBrowser, hasComputer, model, onStep, onPluginAction);
      if (subtask.workerType === "browser" || subtask.workerType === "computer") {
        const verdict = await verifyTaskResult(providerId, apiKey, subtask.description, outcome, model);
        if (!verdict.verified) throw new Error(verdict.reason || "External-tool result could not be verified.");
      }
      return outcome;
    },
    MAX_STEP_ATTEMPTS
  );

  if (recovery.ok) return { ...subtask, status: "done", result: recovery.value, attempts: recovery.attempts };
  return { ...subtask, status: "failed", error: recovery.rawMessage.replace(/^NO_(BROWSER|COMPUTER):\s*/, ""), attempts: recovery.attempts };
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

export type MissionRuntimeOptions = {
  uid: string;
  providerId: string;
  apiKey: string;
  mission: Mission;
  hasBrowser: boolean;
  hasComputer: boolean;
  model?: string;
  onUpdate: (mission: Mission) => void;
  onStep: (s: string) => void;
  onPluginAction?: (task: string) => Promise<string | null>;
  isCancelled: () => boolean;
  onSubtaskMessage: (msg: ChatMessage) => void | Promise<void>;
};

/**
 * Options-object API intentionally avoids positional-argument drift. The
 * production bug that showed "Expected 11 arguments, but got 12" came from
 * changing this runtime while a caller still used the old positional shape.
 */
export async function runMission(options: MissionRuntimeOptions): Promise<Mission> {
  const { uid, providerId, apiKey, mission, hasBrowser, hasComputer, model, onUpdate, onStep, isCancelled, onSubtaskMessage, onPluginAction } = options;
  let current: Mission = { ...mission, subtasks: mission.subtasks.map((s) => ({ ...s })) };

  // Legacy migration: planner is control-plane only. Convert old persisted
  // planner nodes into a real implementation node so old missions can resume.
  current = {
    ...current,
    subtasks: current.subtasks.map((s) => s.workerType === "planner"
      ? { ...s, workerType: hasComputer ? "computer" : "coder", description: `Execute this step for real: ${s.description}` }
      : s),
  };
  await updateMission(uid, mission.id, { subtasks: current.subtasks });
  onUpdate(current);

  while (current.subtasks.some((s) => s.status === "pending")) {
    if (isCancelled()) {
      current = { ...current, status: "cancelled" };
      onUpdate(current);
      await updateMission(uid, mission.id, { status: "cancelled" });
      return current;
    }

    let ready = findReadySubtasks(current.subtasks);
    if (ready.length === 0) {
      // Recovery from malformed/cyclic graphs: unblock one pending node rather
      // than hanging forever. The agent has the current context and can repair.
      const blocked = current.subtasks.filter((s) => s.status === "pending");
      if (!blocked.length) break;
      ready = [blocked[0]];
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
    const results = await Promise.all(
      wave.map((s) => runAndVerify(mission.id, providerId, apiKey, current.objective, s, priorResults, hasBrowser, hasComputer, model, onStep, onPluginAction))
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
    const summaryPrompt = `Objective: "${current.objective}"\n\nWorker results:\n${current.subtasks.map((s) => `- [${s.status}/${s.workerType}] ${s.description}${s.result ? `: ${s.result.slice(0, 700)}` : s.error ? ` (${s.error})` : ""}`).join("\n")}\n\nGive a concise factual summary. Never turn a worker's claim into proof of an external action; report evidence and failures plainly.`;
    const response = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: summaryPrompt }] });
    summary = response.text || summary;
  } catch {
    summary = current.subtasks.map((s) => `${s.status}: ${s.description}`).join("\n");
  }

  current = { ...current, status: finalStatus, summary };
  onUpdate(current);
  await updateMission(uid, mission.id, { status: finalStatus, summary });
  return current;
}