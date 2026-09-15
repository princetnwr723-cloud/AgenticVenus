// lib/integrationKeys.ts
// The user's own keys for the "infrastructure" integrations — Browserless
// (browser automation), E2B (used for both Codespace's "Run in Cloud"
// AND the new Computer Use / cloud PC feature — same key, same account),
// and later Vercel/Netlify for Publish. Stored once in Settings, shared
// across every chat's agent (a live browser login or running sandbox
// still resets per new chat — only the keys themselves are shared).

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type IntegrationKeys = {
  browserlessApiKey?: string;
  daytonaApiKey?: string;
  vercelApiToken?: string;
  netlifyApiToken?: string;
};

export async function getIntegrationKeys(uid: string): Promise<IntegrationKeys> {
  const ref = doc(db, "users", uid, "settings", "integrations");
  const snap = await getDoc(ref);
  return snap.exists() ? (snap.data() as IntegrationKeys) : {};
}

export async function saveIntegrationKeys(uid: string, keys: Partial<IntegrationKeys>) {
  const ref = doc(db, "users", uid, "settings", "integrations");
  await setDoc(ref, keys, { merge: true });
}