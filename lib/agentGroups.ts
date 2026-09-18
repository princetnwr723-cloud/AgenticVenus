// lib/agentGroups.ts
// A Group is 2+ specialist agents working the same task together — each
// contributes its part, then the team's work is synthesized into one
// answer for the user. See lib/groupOrchestrator.ts for the actual run.

import { collection, doc, addDoc, deleteDoc, getDocs, updateDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type AgentGroup = {
  id: string;
  name: string;
  agentIds: string[];
};

export async function listAgentGroups(uid: string): Promise<AgentGroup[]> {
  const ref = collection(db, "users", uid, "agentGroups");
  const snap = await getDocs(ref);
  return snap.docs.map((d) => ({ id: d.id, name: d.data().name, agentIds: d.data().agentIds || [] }));
}

export async function createAgentGroup(uid: string, name: string, agentIds: string[]): Promise<string> {
  const ref = collection(db, "users", uid, "agentGroups");
  const docRef = await addDoc(ref, { name, agentIds, createdAt: serverTimestamp() });
  return docRef.id;
}

export async function updateAgentGroup(uid: string, groupId: string, name: string, agentIds: string[]) {
  await updateDoc(doc(db, "users", uid, "agentGroups", groupId), { name, agentIds });
}

export async function deleteAgentGroup(uid: string, groupId: string) {
  await deleteDoc(doc(db, "users", uid, "agentGroups", groupId));
}