// lib/missions.ts
// A Mission is a tracked multi-step objective — subtasks with real
// status, checkpointed to Firestore after every step, so closing the
// tab (or a crash) never loses progress. "Continue" finds the latest
// unfinished mission for a chat and resumes from its currentIndex.

import { collection, doc, addDoc, updateDoc, deleteDoc, getDoc, getDocs, query, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type MissionSubtaskStatus = "pending" | "running" | "done" | "failed" | "skipped";

export type MissionSubtask = {
  id: string;
  description: string;
  status: MissionSubtaskStatus;
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
  currentIndex: number;
  status: MissionStatus;
  artifacts: string[];
  summary?: string;
  createdAt: number;
  updatedAt: number;
};

export async function createMission(uid: string, chatId: string, objective: string, subtaskDescriptions: string[]): Promise<Mission> {
  const ref = collection(db, "users", uid, "missions");
  const mission: Omit<Mission, "id"> = {
    chatId,
    objective,
    subtasks: subtaskDescriptions.map((d, i) => ({ id: `s${i + 1}`, description: d, status: "pending" as const })),
    currentIndex: 0,
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