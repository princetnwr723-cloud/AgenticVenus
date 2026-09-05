// lib/businessDNA.ts
// "Business DNA": details about the user's business, saved once and then
// woven into every agent's system prompt so it responds like an employee
// of that business rather than a generic assistant.

import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type BusinessDNA = {
  businessName: string;
  industry: string;
  description: string;
  tone: string;
  offerings: string;
  policies: string;
};

const EMPTY: BusinessDNA = {
  businessName: "",
  industry: "",
  description: "",
  tone: "",
  offerings: "",
  policies: "",
};

export async function getBusinessDNA(uid: string): Promise<BusinessDNA | null> {
  const ref = doc(db, "users", uid, "settings", "businessDNA");
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  if (!data.businessName) return null;
  return { ...EMPTY, ...data } as BusinessDNA;
}

export async function saveBusinessDNA(uid: string, dna: BusinessDNA) {
  const ref = doc(db, "users", uid, "settings", "businessDNA");
  await setDoc(ref, { ...dna, updatedAt: serverTimestamp() });
}

/** Turns the saved business details into a system-prompt fragment that
 * gets layered on top of whichever Agent Team persona is active. */
export function buildBusinessContext(dna: BusinessDNA | null): string {
  if (!dna || !dna.businessName.trim()) return "";
  const parts = [
    `You work as an employee of "${dna.businessName}"${
      dna.industry ? ` (${dna.industry})` : ""
    }.`,
  ];
  if (dna.description) parts.push(`About the business: ${dna.description}`);
  if (dna.offerings) parts.push(`Products/services: ${dna.offerings}`);
  if (dna.tone) parts.push(`Preferred tone of voice: ${dna.tone}`);
  if (dna.policies) parts.push(`Business policies to respect: ${dna.policies}`);
  parts.push(
    "Always answer as this business would — represent it accurately and never invent facts about it that weren't given to you."
  );
  return parts.join("\n");
}
