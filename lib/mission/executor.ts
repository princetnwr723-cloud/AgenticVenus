"use client";
// lib/mission/executor.ts
import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { parseFirstJson } from "@/lib/agentJson";
import { AGENT_CORE } from "@/lib/agents";
import { runDeveloperWorkspace } from "@/lib/developerRuntime";
import { startBrowserSession, stopBrowserSession, runBrowserTask } from "@/lib/browserClient";
import { callPluginAction } from "@/lib/pluginOrchestrator";
import { runOutreachWatch } from "@/lib/mission/watcherCore";
import { addScheduledTask } from "@/lib/scheduler";
import type { Mission, MissionTask } from "@/lib/mission/types";

export type ExecutorDeps = {
  uid: string;
  providerId: string;
  apiKey: string;
  model?: string;
  hasBrowser: boolean;
  hasDaytona: boolean;
  gmailConnected: boolean;
  calendarConnected: boolean;
};

function priorResults(mission: Mission, task: MissionTask): string {
  return task.dependsOn
    .map((id) => mission.tasks.find((t) => t.id === id))
    .filter((t): t is MissionTask => !!t)
    .map((t) => `[${t.title}]\n${(t.result || "(no result)").slice(0, 4000)}`)
    .join("\n\n");
}

async function runGeneric(deps: ExecutorDeps, mission: Mission, task: MissionTask, context: string, onLog: (s: string) => void) {
  onLog("Thinking it through…");
  const prompt = `${AGENT_CORE}\n\nMission goal: "${mission.goal}"\nYour part: "${task.title}"\n\nContext from teammates so far:\n${context || "(none yet)"}\n\nDo this part and report back with the concrete result — not a plan, the actual output.`;
  const { text } = await sendChatMessage({ providerId: deps.providerId, apiKey: deps.apiKey, model: deps.model, messages: [{ role: "user", content: prompt }] });
  return text;
}

async function runResearch(deps: ExecutorDeps, mission: Mission, task: MissionTask, context: string, onLog: (s: string) => void) {
  if (!deps.hasBrowser) return runGeneric(deps, mission, task, context, onLog);
  onLog("Opening the browser…");
  const { sessionId } = await startBrowserSession();
  try {
    return await runBrowserTask(deps.providerId, deps.apiKey, sessionId, `${task.title}\n\nMission goal for context: ${mission.goal}`, deps.model, onLog);
  } finally {
    await stopBrowserSession(sessionId);
  }
}

async function runBuild(deps: ExecutorDeps, mission: Mission, task: MissionTask, context: string, onLog: (s: string) => void) {
  if (!deps.hasDaytona) {
    return runGeneric(
      deps,
      mission,
      task,
      `${context}\n\n(No cloud workspace connected — write the answer as plain text instead of real files, and say a Daytona key in Settings → Integrations would give a real, previewable build.)`,
      onLog
    );
  }
  const fullTask = `${task.title}\n\nMission goal for context: ${mission.goal}${context ? `\n\nWhat teammates already produced:\n${context}` : ""}`;
  const result = await runDeveloperWorkspace(deps.providerId, deps.apiKey, fullTask, deps.model, [] as ChatMessage[], onLog, `mission-${mission.id}`);
  const bits = [`Build ${result.buildOk ? "succeeded" : "had issues"}.`, `Files: ${result.changedFiles.join(", ") || "(none written)"}`];
  if (result.previewUrl) bits.push(`Live preview: ${result.previewUrl}`);
  return bits.join("\n");
}

async function runLeadgen(deps: ExecutorDeps, mission: Mission, task: MissionTask, context: string, onLog: (s: string) => void) {
  if (!deps.hasBrowser) return runGeneric(deps, mission, task, context, onLog);
  onLog("Searching for leads…");
  const { sessionId } = await startBrowserSession();
  try {
    const instructions = `${task.title}\n\nMission goal for context: ${mission.goal}\n\nFor each lead you find, note: a name or company, their website or contact page URL, and an email address if one is visible on the page (many sites won't show one — that's fine, note the contact page URL instead). Stop once you've gathered a reasonable, genuinely-checked list — real research is slow, so quality over a fake round number. List them one per line as: Name | email or contact URL | one-line reason they're a fit.`;
    return await runBrowserTask(deps.providerId, deps.apiKey, sessionId, instructions, deps.model, onLog);
  } finally {
    await stopBrowserSession(sessionId);
  }
}

async function runOutreach(deps: ExecutorDeps, mission: Mission, task: MissionTask, context: string, onLog: (s: string) => void) {
  if (!deps.gmailConnected) {
    return `Gmail isn't connected, so I couldn't draft real emails. Connect Gmail in Plugins, then re-run this step. Here's what the outreach would say based on what teammates found:\n\n${context.slice(0, 2000)}`;
  }
  onLog("Drafting an email per lead…");
  const draftPrompt = `${AGENT_CORE}\n\nMission goal: "${mission.goal}"\nYour part: "${task.title}"\n\nWhat teammates produced (the built site / lead list):\n${context.slice(0, 6000)}\n\nExtract the leads with an email address. For each, write a short, specific, non-spammy outreach email (max 120 words) that mentions the built thing (link if there is one). Reply with ONLY raw JSON: {"emails":[{"to":"...","subject":"...","body":"..."}]}`;
  const { text } = await sendChatMessage({ providerId: deps.providerId, apiKey: deps.apiKey, model: deps.model, messages: [{ role: "user", content: draftPrompt }] });
  const parsed = parseFirstJson<{ emails?: { to: string; subject: string; body: string }[] }>(text);
  const emails = (parsed?.emails || []).filter((e) => e?.to && e?.subject && e?.body);

  let created = 0;
  const failures: string[] = [];
  for (const e of emails) {
    onLog(`Drafting to ${e.to}…`);
    try {
      await callPluginAction("gmail", "gmail.create_draft", { to: e.to, subject: e.subject, body: e.body });
      created++;
    } catch (err) {
      failures.push(`${e.to}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return [
    `Created ${created} Gmail draft(s) out of ${emails.length} lead(s) with an email address.`,
    "Drafts only — nothing was sent. Open Gmail to review and send them, or ask me to send a specific one.",
    failures.length ? `Failed:\n${failures.join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

async function runWatcher(deps: ExecutorDeps, mission: Mission, task: MissionTask, context: string, onLog: (s: string) => void) {
  onLog("Checking for replies…");
  const result = deps.gmailConnected
    ? await runOutreachWatch(deps.providerId, deps.apiKey, deps.model, (toolId, actionId, params) => callPluginAction(toolId, actionId, params), context)
    : { checked: 0, booked: 0, summary: "Gmail isn't connected, so replies can't be checked automatically." };

  // Keep checking even after this run ends / the tab closes, via the
  // existing scheduler + the server-side cron at /api/missions/tick.
  try {
    await addScheduledTask(deps.uid, `__MISSION_WATCH__:${mission.id}`, new Date(Date.now() + 60 * 60 * 1000), "hourly", mission.chatId || undefined);
  } catch {
    // best-effort — the immediate check above still ran
  }

  return `${result.summary}\n\n(I'll keep checking for replies roughly every hour, even after you close this — the mission will update if new bookings come in.)`;
}

async function runReport(deps: ExecutorDeps, mission: Mission, task: MissionTask, context: string, onLog: (s: string) => void) {
  onLog("Writing the summary…");
  const prompt = `${AGENT_CORE}\n\nMission goal: "${mission.goal}"\n\nEvery teammate's result:\n${context}\n\nWrite ONE clear final summary for the user: what was actually accomplished (be honest about anything partial or unverified), links/results they should look at, and what — if anything — is still in progress or needs their approval (e.g. sending drafted emails).`;
  const { text } = await sendChatMessage({ providerId: deps.providerId, apiKey: deps.apiKey, model: deps.model, messages: [{ role: "user", content: prompt }] });
  return text;
}

export async function runMissionTask(deps: ExecutorDeps, mission: Mission, task: MissionTask, onLog: (s: string) => void): Promise<string> {
  const context = priorResults(mission, task);
  switch (task.role) {
    case "research":
      return runResearch(deps, mission, task, context, onLog);
    case "build":
      return runBuild(deps, mission, task, context, onLog);
    case "leadgen":
      return runLeadgen(deps, mission, task, context, onLog);
    case "outreach":
      return runOutreach(deps, mission, task, context, onLog);
    case "watcher":
      return runWatcher(deps, mission, task, context, onLog);
    case "report":
      return runReport(deps, mission, task, context, onLog);
    default:
      return runGeneric(deps, mission, task, context, onLog);
  }
}