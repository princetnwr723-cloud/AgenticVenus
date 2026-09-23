// lib/mission/store.ts
import { collection, doc, addDoc, getDoc, getDocs, orderBy, query, setDoc, deleteDoc, runTransaction } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Mission, MissionTask } from "@/lib/mission/types";

export async function createMission(uid: string, goal: string, tasks: MissionTask[], chatId?: string): Promise<string> {
  const ref = collection(db, "users", uid, "missions");
  const docRef = await addDoc(ref, { goal, tasks, status: "running", chatId: chatId || null, createdAt: Date.now(), updatedAt: Date.now() });
  return docRef.id;
}

export async function getMission(uid: string, missionId: string): Promise<Mission | null> {
  const snap = await getDoc(doc(db, "users", uid, "missions", missionId));
  if (!snap.exists()) return null;
  return { id: snap.id, ...(snap.data() as any) } as Mission;
}

export async function listMissions(uid: string): Promise<Mission[]> {
  const q = query(collection(db, "users", uid, "missions"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d: any) => ({ id: d.id, ...(d.data() as any) }));
}

export async function saveMission(uid: string, missionId: string, patch: Partial<Mission>) {
  await setDoc(doc(db, "users", uid, "missions", missionId), { ...patch, updatedAt: Date.now() }, { merge: true });
}

export async function deleteMission(uid: string, missionId: string) {
  await deleteDoc(doc(db, "users", uid, "missions", missionId));
}

/** Transactional so two tasks finishing at nearly the same time never
 * clobber each other's update. */
export async function patchTask(uid: string, missionId: string, taskId: string, patch: Partial<MissionTask>) {
  const ref = doc(db, "users", uid, "missions", missionId);
  await runTransaction(db, async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    const tasks = ((data.tasks || []) as MissionTask[]).map((t) => (t.id === taskId ? { ...t, ...patch, updatedAt: Date.now() } : t));
    tx.update(ref, { tasks, updatedAt: Date.now() });
  });
}

/** Marks a set of tasks "running" in one write (the start of a parallel wave). */
export async function markRunning(uid: string, missionId: string, taskIds: string[]) {
  const ref = doc(db, "users", uid, "missions", missionId);
  await runTransaction(db, async (tx: any) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const data = snap.data() as any;
    const tasks = ((data.tasks || []) as MissionTask[]).map((t) => (taskIds.includes(t.id) ? { ...t, status: "running" as const, updatedAt: Date.now() } : t));
    tx.update(ref, { tasks, updatedAt: Date.now() });
  });
}