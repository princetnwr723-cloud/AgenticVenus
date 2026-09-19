// lib/missions.ts
// A Mission's subtasks now form a real dependency graph — each subtask
// knows which OTHER subtasks (by id) must finish first. Independent
// subtasks (empty dependsOn, or all their dependencies already done)
// run CONCURRENTLY instead of one-by-one — see lib/missionEngine.ts.

import { collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type MissionSubtaskStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type WorkerType = "planner" | "researcher" | "browser" | "computer" | "coder" | "data" | "file" | "qa" | "writer" | "security";

export type MissionSubtask = {
  id: string;
  description: string;
  status: MissionSubtaskStatus;
  dependsOn: string[]; // subtask ids that must be "done" before this can run
  workerType: WorkerType;
  result?: string;
  error?: string;
  attempts?: number;
};

export type MissionStatus =
  | "running" | "waiting_for_user" | "recovering" | "verifying"
  | "completed" | "failed" | "cancelled";

export type Mission = {
  id: string;
  chatId: string;
  objective: string;
  subtasks: MissionSubtask[];
  status: MissionStatus;
  artifacts: string[];
  summary?: string;
  createdAt: number;
  updatedAt: number;
};

export type SubtaskDraft = { description: string; dependsOnIndexes: number[]; workerType: WorkerType };

export async function createMission(uid: string, chatId: string, objective: string, drafts: SubtaskDraft[]): Promise<Mission> {
  const ids = drafts.map((_, i) => `s${i + 1}`);
  const subtasks: MissionSubtask[] = drafts.map((d, i) => ({
    id: ids[i],
    description: d.description,
    status: "pending",
    dependsOn: (d.dependsOnIndexes || []).filter((idx) => idx >= 0 && idx < ids.length && idx !== i).map((idx) => ids[idx]),
    workerType: d.workerType || "planner",
  }));

  const ref = collection(db, "users", uid, "missions");
  const mission: Omit<Mission, "id"> = {
    chatId,
    objective,
    subtasks,
    status: "running",
    artifacts: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  const docRef = await addDoc(ref, mission);
  return { id: docRef.id, ...mission };
}

export async function updateMission(uid: string, missionId: string, patch: Partial<Mission>) {
  await updateDoc(doc(db, "users", uid, "missions", missionId), { ...patch, updatedAt: Date.now() });
}

export async function getMission(uid: string, missionId: string): Promise<Mission | null> {
  const snap = await getDoc(doc(db, "users", uid, "missions", missionId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as Omit<Mission, "id">) };
}

export async function listMissions(uid: string): Promise<Mission[]> {
  const ref = collection(db, "users", uid, "missions");
  const snap = await getDocs(query(ref, orderBy("updatedAt", "desc")));
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Mission, "id">) }));
}

export async function findResumableMission(uid: string, chatId: string): Promise<Mission | null> {
  const all = await listMissions(uid);
  return all.find((m) => m.chatId === chatId && !["completed", "cancelled"].includes(m.status)) || null;
}

export async function deleteMission(uid: string, missionId: string) {
  await deleteDoc(doc(db, "users", uid, "missions", missionId));
}