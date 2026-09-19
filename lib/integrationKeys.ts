// lib/integrationKeys.ts
// Client-side: only ever holds presence flags (is a key set or not) —
// never the actual secret value. Real values are AES-256-GCM encrypted
// at rest and decrypted only inside a server route, just before use
// (see lib/secretsResolve.ts). This is what the rest of the app already
// only needed anyway (`!!integrationKeys.xxx` checks), so nothing else
// has to change.

import { auth } from "@/lib/firebase";

export type IntegrationKeys = {
  daytonaApiKey?: boolean;
  browserlessApiKey?: boolean;
  vercelApiToken?: boolean;
  netlifyApiToken?: boolean;
};

async function authedHeaders() {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  return { "content-type": "application/json", authorization: `Bearer ${idToken}` };
}

export async function getIntegrationKeys(uid: string): Promise<IntegrationKeys> {
  const res = await fetch("/api/secrets/integrations", { headers: await authedHeaders() });
  const data = await res.json();
  if (!res.ok) return {};
  return data.presence as IntegrationKeys;
}

/** Kept as a batch call to match existing call sites — saves whichever
 * fields have a non-empty value, one encrypted write per field. */
export async function saveIntegrationKeys(uid: string, partial: Partial<Record<keyof IntegrationKeys, string>>): Promise<void> {
  const headers = await authedHeaders();
  for (const [field, value] of Object.entries(partial)) {
    if (!value) continue;
    const res = await fetch("/api/secrets/integrations", {
      method: "POST",
      headers,
      body: JSON.stringify({ field, value }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      throw new Error(data?.error || `Failed to save ${field}.`);
    }
  }
}

export async function deleteIntegrationKey(field: keyof IntegrationKeys): Promise<void> {
  const res = await fetch("/api/secrets/integrations", {
    method: "DELETE",
    headers: await authedHeaders(),
    body: JSON.stringify({ field }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "Failed to remove.");
  }
}