"use client";
// lib/missionRunner.ts
import { getMission, saveMission, markRunning, patchTask } from "@/lib/mission/store";
import { runMissionTask, type ExecutorDeps } from "@/lib/mission/executor";
import type { Mission, MissionTask } from "@/lib/mission/types";
import { saveChatMessages, getChat } from "@/lib/chats";

function readyTasks(mission: Mission): MissionTask[] {
  const doneIds = new Set(mission.tasks.filter((t) => t.status === "done").map((t) => t.id));
  return mission.tasks.filter((t) => t.status === "pending" && t.dependsOn.every((d) => doneIds.has(d)));
}

export type RunOptions = { onUpdate?: (mission: Mission) => void };

/** Runs every task whose dependencies are satisfied, in parallel waves,
 * persisting progress to Firestore after each task so the panel (or a
 * reopened tab) always shows the real state. */
export async function runMission(deps: ExecutorDeps, missionId: string, opts: RunOptions = {}): Promise<void> {
  for (let wave = 0; wave < 12; wave++) {
    const mission = await getMission(deps.uid, missionId);
    if (!mission) return;
    const ready = readyTasks(mission);

    if (!ready.length) {
      const stillRunning = mission.tasks.some((t) => t.status === "running");
      if (stillRunning) {
        await new Promise((r) => setTimeout(r, 1000));
        continue;
      }
      if (mission.tasks.every((t) => t.status === "done" || t.status === "skipped")) {
        await saveMission(deps.uid, missionId, { status: "done" });
        await postReportToChat(deps.uid, (await getMission(deps.uid, missionId))!);
      } else if (mission.tasks.some((t) => t.status === "failed")) {
        await saveMission(deps.uid, missionId, { status: "failed" });
      }
      opts.onUpdate?.((await getMission(deps.uid, missionId))!);
      return;
    }

    await markRunning(deps.uid, missionId, ready.map((t) => t.id));
    opts.onUpdate?.((await getMission(deps.uid, missionId))!);

    await Promise.all(
      ready.map(async (task) => {
        const freshMission = (await getMission(deps.uid, missionId))!;
        try {
          const result = await runMissionTask(deps, freshMission, task, () => {});
          await patchTask(deps.uid, missionId, task.id, { status: "done", result });
        } catch (err) {
          await patchTask(deps.uid, missionId, task.id, { status: "failed", error: err instanceof Error ? err.message : String(err) });
        }
        opts.onUpdate?.((await getMission(deps.uid, missionId))!);
      })
    );
  }
}

async function postReportToChat(uid: string, mission: Mission) {
  if (!mission.chatId) return;
  const reportTask = mission.tasks.find((t) => t.role === "report");
  if (!reportTask?.result) return;
  const chat = await getChat(uid, mission.chatId);
  if (!chat) return;
  const marker = `**Mission complete — ${mission.goal}**`;
  const already = chat.messages.some((m) => m.content.startsWith(marker));
  if (already) return;
  await saveChatMessages(uid, mission.chatId, [...chat.messages, { role: "assistant", content: `${marker}\n\n${reportTask.result}` }], chat.agentId, chat.providerId);
}