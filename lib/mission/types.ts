// lib/mission/types.ts
// A Mission is a big, multi-part goal broken into a small DAG of tasks that
// specialist agents run — independent tasks in parallel, dependent ones
// waiting on their inputs — like "build a website" + "find leads" (parallel)
// -> "email them" (needs both) -> "watch for replies & book" -> "report".

export type MissionTaskRole = "research" | "build" | "leadgen" | "outreach" | "watcher" | "report" | "generic";
export type MissionTaskStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type MissionTask = {
  id: string;
  title: string;
  role: MissionTaskRole;
  dependsOn: string[];
  status: MissionTaskStatus;
  result?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
};

export type MissionStatus = "planning" | "running" | "done" | "failed";

export type Mission = {
  id: string;
  goal: string;
  status: MissionStatus;
  tasks: MissionTask[];
  chatId?: string | null;
  createdAt: number;
  updatedAt: number;
};