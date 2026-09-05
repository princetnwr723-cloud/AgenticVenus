// lib/connections.ts
// Reads the AI provider connections a user has saved under
// users/{uid}/connections in Firestore.

import { collection, getDocs, orderBy, query, limit } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PROVIDERS, type Provider } from "@/lib/providers";

export type SavedConnection = {
  provider: Provider;
  apiKey: string;
};

/** Returns the most recently connected provider + key, or null if none. */
export async function getPrimaryConnection(
  uid: string
): Promise<SavedConnection | null> {
  const ref = collection(db, "users", uid, "connections");
  const q = query(ref, orderBy("connectedAt", "desc"), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;

  const data = snap.docs[0].data();
  const provider = PROVIDERS.find((p) => p.id === data.providerId);
  if (!provider || !data.apiKey) return null;

  return { provider, apiKey: data.apiKey };
}