// lib/missionEngine.ts
// TWO CRITICAL FIXES from the real-estate-scraping bug report:
// 1. A subtask whose workerType is "browser"/"computer" now REQUIRES
//    that tool — if the key isn't configured, it fails immediately with
//    a clear "add your key" message instead of silently answering from
//    the model's own (unreliable) knowledge.
// 2. Every subtask's RAW output (including any code) is now pushed as
//    its own real chat message via onSubtaskMessage — visible live,
//    with the right specialist "agent" label — instead of being buried
//    and only reaching the user as a vague paraphrased final summary.

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { decideAutoTools } from "@/lib/autoTools";
import { startBrowserSession, stopBrowserSession, runBrowserTask } from "@/lib/browserClient";
import { startComputerSession, stopComputerSession, runComputerTask } from "@/lib/computerClient";
import { updateMission, type Mission, type MissionSubtask, type WorkerType } from "@/lib/missions";
import { verifyTaskResult } from "@/lib/verification";
import { withRecovery } from "@/lib/recoveryEngine";
import { getAgentById } from "@/lib/agents";

const MAX_CONCURRENCY = 3;

const WORKER_LABEL: Record<WorkerType, string> = {
  planner: "🧭 Planner", researcher: "🔎 Researcher", browser: "🌐 Browser", computer: "🖥️ Computer",
  coder: "💻 Coder", data: "📊 Data", file: "📁 File", qa: "✅ QA", writer: "✍️ Writer", security: "🛡️ Security",
};
const WORKER_COLOR: Record<WorkerType, string> = {
  planner: "#8A8578", researcher: "#20808D", browser: "#5A6B4E", computer: "#D97757",
  coder: "#4D6BFE", data: "#00A1E0", file: "#8A8578", qa: "#BF5F3F", writer: "#5A6B4E", security: "#6467F2",
};

async function runOneSubtask(
  providerId: string, apiKey: string, objective: string, subtask: MissionSubtask,
  priorResults: string[], hasBrowser: boolean, hasComputer: boolean, model: string | undefined,
  onStep: (s: string) => void
): Promise<string> {
  const context = priorResults.length ? `Relevant results from finished subtasks:\n${priorResults.map((r, i) => `${i + 1}. ${r}`).join("\n")}\n\n` : "";

  // A subtask explicitly assigned to a worker type that NEEDS a real
  // tool must actually use it — no silent fallback to guessing.
  if (subtask.workerType === "browser") {
    if (!hasBrowser) {
      throw new Error("NO_BROWSER: Browser isn't connected — add a Browserless API key in Settings → Integrations so I can actually visit and scrape real websites for this.");
    }
    onStep(`🌐 [${subtask.id}] Starting the browser...`);
    const { sessionId } = await startBrowserSession();
    try {
      return await runBrowserTask(providerId, apiKey, sessionId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`));
    } finally {
      await stopBrowserSession(sessionId);
    }
  }

  if (subtask.workerType === "computer") {
    if (!hasComputer) {
      throw new Error("NO_COMPUTER: A cloud computer isn't connected — add a Daytona API key in Settings → Integrations so I can actually use a desktop for this.");
    }
    onStep(`🖥️ [${subtask.id}] Starting the computer...`);
    const { sandboxId } = await startComputerSession();
    try {
      return await runComputerTask(providerId, apiKey, sandboxId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`));
    } finally {
      await stopComputerSession(sandboxId);
    }
  }

  // Other worker types may still incidentally need browser/computer
  // (e.g. a "researcher" step that turns out to need a live source) —
  // decide from the actual content, gated on real availability, and if
  // it's needed-but-missing, fail honestly rather than guess.
  const autoDecision = await decideAutoTools(providerId, apiKey, subtask.description, hasBrowser, hasComputer, [], model);
  let toolNote = "";
  if (autoDecision.needsBrowser) {
    onStep(`🌐 [${subtask.id}] Starting the browser...`);
    const { sessionId } = await startBrowserSession();
    try {
      toolNote = `Used the browser: ${await runBrowserTask(providerId, apiKey, sessionId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`))}`;
    } finally {
      await stopBrowserSession(sessionId);
    }
  } else if (autoDecision.needsComputer) {
    onStep(`🖥️ [${subtask.id}] Starting the computer...`);
    const { sandboxId } = await startComputerSession();
    try {
      toolNote = `Used the computer: ${await runComputerTask(providerId, apiKey, sandboxId, subtask.description, model, (s) => onStep(`[${subtask.id}] ${s}`))}`;
    } finally {
      await stopComputerSession(sandboxId);
    }
  } else if (autoDecision.browserUnavailable) {
    throw new Error("NO_BROWSER: This step needs real web access — add a Browserless API key in Settings → Integrations.");
  } else if (autoDecision.computerUnavailable) {
    throw new Error("NO_COMPUTER: This step needs a real cloud computer — add a Daytona API key in Settings → Integrations.");
  }

  const isCoder = subtask.workerType === "coder";
  const prompt = `You're the "${subtask.workerType}" specialist on a team working toward this objective: "${objective}"\n\n${context}Your subtask: "${subtask.description}"${
    toolNote ? `\n\n${toolNote}` : ""
  }\n\nGive your real result for this subtask.`;

  const { text } = await sendChatMessage({
    providerId, apiKey, model,
    messages: [{ role: "user", content: prompt }],
    systemPrompt: isCoder ? getAgentById("developer").systemPrompt : undefined,
  });
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

  if (recovery.ok) {
    return { ...subtask, status: "done", result: recovery.value, attempts: recovery.attempts };
  }
  const cleanError = recovery.rawMessage.replace(/^NO_(BROWSER|COMPUTER):\s*/, "");
  return { ...subtask, status: "failed", error: cleanError, attempts: recovery.attempts };
}

function subtaskToMessage(s: MissionSubtask): ChatMessage {
  const label = `${WORKER_LABEL[s.workerType]} — ${s.description}`;
  if (s.status === "done") {
    return { role: "assistant", content: s.result || "(no output)", agentName: label, agentColor: WORKER_COLOR[s.workerType] };
  }
  return { role: "assistant", content: `⚠️ Couldn't complete this: ${s.error}`, agentName: label, agentColor: "#BF5F3F" };
}

function findReadySubtasks(subtasks: MissionSubtask[]): MissionSubtask[] {
  const doneIds = new Set(subtasks.filter((s) => s.status === "done" || s.status === "skipped").map((s) => s.id));
  return subtasks.filter((s) => s.status === "pending" && s.dependsOn.every((dep) => doneIds.has(dep)));
}

export async function runMission(
  uid: string, providerId: string, apiKey: string, mission: Mission,
  hasBrowser: boolean, hasComputer: boolean, model: string | undefined,
  onUpdate: (mission: Mission) => void, onStep: (s: string) => void,
  isCancelled: () => boolean,
  onSubtaskMessage: (msg: ChatMessage) => void | Promise<void>
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

    await Promise.all(
      wave.map(async (s) => {
        const result = await runAndVerify(uid, mission.id, providerId, apiKey, current.objective, s, priorResults, hasBrowser, hasComputer, model, onStep);
        current.subtasks = current.subtasks.map((x) => (x.id === result.id ? result : x));
        onUpdate(current);
        await updateMission(uid, mission.id, { subtasks: current.subtasks });
        await onSubtaskMessage(subtaskToMessage(result)); // ← real output hits the chat immediately
      })
    );
  }

  const anyFailed = current.subtasks.some((s) => s.status === "failed");
  const finalStatus = current.status === "cancelled" ? "cancelled" : anyFailed ? "failed" : "completed";

  const summaryPrompt = `Objective: "${current.objective}"\n\nResults:\n${current.subtasks
    .map((s) => `- [${s.status}/${s.workerType}] ${s.description}${s.result ? `: ${s.result.slice(0, 300)}` : s.error ? ` (${s.error})` : ""}`)
    .join("\n")}\n\nWrite a short final summary — what was accomplished, what failed if anything, and what the user might want to do next.`;
  const { text: summary } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: summaryPrompt }] });

  current = { ...current, status: finalStatus, summary };
  onUpdate(current);
  await updateMission(uid, mission.id, { status: finalStatus, summary });
  return current;
}