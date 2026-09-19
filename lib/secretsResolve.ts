// lib/secretsResolve.ts
// Server-only. Resolves an encrypted integration secret to its plaintext
// value at the moment a route actually needs it — the value never sits
// in memory longer than one request, and never reaches the client.

import { adminDb } from "@/lib/firebaseAdmin";
import { decryptSecret, type EncryptedPayload } from "@/lib/secretsVault";

export const INTEGRATION_FIELDS = ["daytonaApiKey", "browserlessApiKey", "vercelApiToken", "netlifyApiToken"] as const;
export type IntegrationField = (typeof INTEGRATION_FIELDS)[number];
export type ResolvedIntegrationKeys = Partial<Record<IntegrationField, string>>;

export async function resolveIntegrationSecret(uid: string, field: IntegrationField): Promise<string | undefined> {
  const snap = await adminDb().collection("users").doc(uid).collection("settings").doc("integrations").get();
  if (!snap.exists) return undefined;
  const enc = snap.data()?.[`${field}_enc`] as EncryptedPayload | undefined;
  if (!enc) return undefined;
  try {
    return decryptSecret(enc);
  } catch (err) {
    console.error(`[secretsResolve] failed to decrypt ${field} for ${uid}:`, err);
    return undefined;
  }
}

export async function resolveAllIntegrationSecrets(uid: string): Promise<ResolvedIntegrationKeys> {
  const snap = await adminDb().collection("users").doc(uid).collection("settings").doc("integrations").get();
  if (!snap.exists) return {};
  const data = snap.data()!;
  const out: ResolvedIntegrationKeys = {};
  for (const f of INTEGRATION_FIELDS) {
    const enc = data[`${f}_enc`] as EncryptedPayload | undefined;
    if (enc) {
      try {
        out[f] = decryptSecret(enc);
      } catch (err) {
        console.error(`[secretsResolve] decrypt failed for ${f}:`, err);
      }
    }
  }
  return out;
}

export async function getIntegrationPresence(uid: string): Promise<Record<IntegrationField, boolean>> {
  const snap = await adminDb().collection("users").doc(uid).collection("settings").doc("integrations").get();
  const data = snap.exists ? snap.data()! : {};
  const out = {} as Record<IntegrationField, boolean>;
  for (const f of INTEGRATION_FIELDS) out[f] = !!data[`${f}_enc`];
  return out;
}