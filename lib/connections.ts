// lib/connections.ts
// Provider API keys (Claude, GPT, Gemini, etc.) are now encrypted at
// rest — reads/writes go through /api/secrets/connections instead of
// touching Firestore directly for the apiKey field. Model choice isn't
// sensitive, so it still writes via the client SDK directly.

import { doc, setDoc } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
import { PROVIDERS, type Provider } from "@/lib/providers";

export type SavedConnection = {
  provider: Provider;
  apiKey: string;
  model?: string;
};

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

async function fetchConnections(): Promise<(SavedConnection & { connectedAt: number })[]> {
  const res = await fetch("/api/secrets/connections", { headers: await authedHeaders() });
  const data = await res.json();
  if (!res.ok) return [];
  return (data.connections as any[])
    .map((c) => {
      const provider = PROVIDERS.find((p) => p.id === c.providerId);
      if (!provider) return null;
      return { provider, apiKey: c.apiKey, model: c.model, connectedAt: c.connectedAt || 0 };
    })
    .filter(Boolean) as (SavedConnection & { connectedAt: number })[];
}

/** Returns the most recently connected provider + key, or null if none. */
export async function getPrimaryConnection(uid: string): Promise<SavedConnection | null> {
  const all = await fetchConnections();
  if (all.length === 0) return null;
  return all.sort((a, b) => b.connectedAt - a.connectedAt)[0];
}

/** Returns every provider connection the user has saved. */
export async function getAllConnections(uid: string): Promise<SavedConnection[]> {
  return fetchConnections();
}

export async function saveConnection(providerId: string, providerName: string, apiKey: string): Promise<void> {
  const res = await fetch("/api/secrets/connections", {
    method: "POST",
    headers: await authedHeaders(),
    body: JSON.stringify({ providerId, providerName, apiKey }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "Failed to save the connection.");
  }
}

export async function updateConnectionModel(uid: string, providerId: string, model: string) {
  const ref = doc(db, "users", uid, "connections", providerId);
  await setDoc(ref, { model }, { merge: true });
}