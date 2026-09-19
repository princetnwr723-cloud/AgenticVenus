// lib/secretsVault.ts
// AES-256-GCM encryption for any secret at rest. Server-only — never
// import this from client code (uses Node's crypto module and a master
// key that must never reach the browser).

import crypto from "crypto";

const ALGO = "aes-256-gcm";

function getMasterKey(): Buffer {
  const b64 = process.env.ENCRYPTION_MASTER_KEY;
  if (!b64) {
    throw new Error(
      "ENCRYPTION_MASTER_KEY isn't set — generate one with `openssl rand -base64 32` and add it as an env var."
    );
  }
  const key = Buffer.from(b64, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_MASTER_KEY must decode to exactly 32 bytes — generate with `openssl rand -base64 32`.");
  }
  return key;
}

export type EncryptedPayload = { ciphertext: string; iv: string; authTag: string };

export function encryptSecret(plaintext: string): EncryptedPayload {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: authTag.toString("base64"),
  };
}

export function decryptSecret(payload: EncryptedPayload): string {
  const key = getMasterKey();
  const decipher = crypto.createDecipheriv(ALGO, key, Buffer.from(payload.iv, "base64"));
  decipher.setAuthTag(Buffer.from(payload.authTag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, "base64")),
    decipher.final(),
  ]);
  return plaintext.toString("utf8");
}