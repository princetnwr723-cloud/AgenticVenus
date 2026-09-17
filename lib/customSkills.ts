// lib/customSkills.ts
// Skills the user installed from a SKILL.md link, rather than the
// built-in catalog. Stored in full (not just an id) since there's no
// static catalog entry to look them up by.

import { collection, doc, deleteDoc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { Skill } from "@/lib/skills";

export async function listCustomSkills(uid: string): Promise<Skill[]> {
  const ref = collection(db, "users", uid, "customSkills");
  const snap = await getDocs(ref);
  return snap.docs.map((d) => d.data() as Skill);
}

export async function saveCustomSkill(uid: string, skill: Skill, sourceUrl: string) {
  const ref = doc(db, "users", uid, "customSkills", skill.id);
  await setDoc(ref, { ...skill, sourceUrl, installedAt: serverTimestamp() });
}

export async function deleteCustomSkill(uid: string, skillId: string) {
  await deleteDoc(doc(db, "users", uid, "customSkills", skillId));
}