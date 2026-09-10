// lib/userPlan.ts
// The user's chosen plan, and a simple daily counter of AI messages sent
// — checked before each send against that plan's limit.

import { doc, getDoc, setDoc, increment } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { getPlan, type PlanId } from "@/lib/plans";

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function getUserPlanId(uid: string): Promise<PlanId> {
  const ref = doc(db, "users", uid, "settings", "plan");
  const snap = await getDoc(ref);
  if (!snap.exists()) return "free";
  return (snap.data().planId as PlanId) || "free";
}

export async function setUserPlanId(uid: string, planId: PlanId) {
  const ref = doc(db, "users", uid, "settings", "plan");
  await setDoc(ref, { planId }, { merge: true });
}

export async function getTodayUsage(uid: string): Promise<number> {
  const ref = doc(db, "users", uid, "usage", todayKey());
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data().count as number) || 0 : 0;
}

export async function incrementTodayUsage(uid: string) {
  const ref = doc(db, "users", uid, "usage", todayKey());
  await setDoc(ref, { count: increment(1) }, { merge: true });
}

export async function canSendMessage(uid: string): Promise<{ allowed: boolean; used: number; limit: number | null }> {
  const [planId, used] = await Promise.all([getUserPlanId(uid), getTodayUsage(uid)]);
  const plan = getPlan(planId);
  if (plan.aiMessagesPerDay === null) return { allowed: true, used, limit: null };
  return { allowed: used < plan.aiMessagesPerDay, used, limit: plan.aiMessagesPerDay };
}