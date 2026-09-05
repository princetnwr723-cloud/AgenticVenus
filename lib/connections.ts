// lib/connections.ts
// Reads/writes the AI provider connections a user has saved under
// users/{uid}/connections in Firestore. A user can have several
// providers connected at once — one is the workspace default, but any
// chat can use a different one via the Settings panel.

import {
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  limit,
  setDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PROVIDERS, type Provider } from "@/lib/providers";

export type SavedConnection = {
  provider: Provider;
  apiKey: string;
  model?: string;
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

  return { provider, apiKey: data.apiKey, model: data.model };
}

/** Returns every provider connection the user has saved. */
export async function getAllConnections(uid: string): Promise<SavedConnection[]> {
  const ref = collection(db, "users", uid, "connections");
  const snap = await getDocs(ref);
  const out: SavedConnection[] = [];
  for (const d of snap.docs) {
    const data = d.data();
    const provider = PROVIDERS.find((p) => p.id === data.providerId);
    if (provider && data.apiKey) {
      out.push({ provider, apiKey: data.apiKey, model: data.model });
    }
  }
  return out;
}

/** Saves which specific model a connection should use (from the live
 * model list in lib/modelList.ts). */
export async function updateConnectionModel(
  uid: string,
  providerId: string,
  model: string
) {
  const ref = doc(db, "users", uid, "connections", providerId);
  await setDoc(ref, { model }, { merge: true });
}