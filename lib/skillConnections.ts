// lib/skillConnections.ts
// Tracks which skills a user has installed, and builds the system-prompt
// fragment for all currently installed skills.

import { collection, deleteDoc, doc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { SKILLS_CATALOG } from "@/lib/skills";

export async function listInstalledSkillIds(uid: string): Promise<string[]> {
  const ref = collection(db, "users", uid, "installedSkills");
  const snap = await getDocs(ref);
  return snap.docs.map((d) => d.id);
}

export async function installSkill(uid: string, skillId: string) {
  const ref = doc(db, "users", uid, "installedSkills", skillId);
  await setDoc(ref, { installedAt: serverTimestamp() });
}

export async function uninstallSkill(uid: string, skillId: string) {
  await deleteDoc(doc(db, "users", uid, "installedSkills", skillId));
}

export function buildInstalledSkillsContext(installedIds: string[]): string {
  const skills = SKILLS_CATALOG.filter((s) => installedIds.includes(s.id));
  if (skills.length === 0) return "";
  return `Installed skills — apply these when relevant:\n${skills
    .map((s) => `- [${s.name}] ${s.instructions}`)
    .join("\n")}`;
}