// lib/previewToken.ts
// Server-only. Short-lived signed tokens for the preview proxy
// (app/api/preview/[token]/...). An iframe can't send an Authorization
// header, so instead of a Firebase ID token we mint a small HMAC-signed
// token scoped to exactly one (uid, sandboxId, port) with an expiry — the
// proxy verifies it and resolves the real Daytona URL server-side.

import crypto from "crypto";

export type PreviewTokenPayload = {
  uid: string;
  sandboxId: string;
  port: number;
  exp: number; // epoch ms
};

function getSecret(): string {
  const s = process.env.PREVIEW_TOKEN_SECRET || process.env.ENCRYPTION_MASTER_KEY;
  if (!s) {
    throw new Error(
      "Set PREVIEW_TOKEN_SECRET (or ENCRYPTION_MASTER_KEY, already used for secrets) as an env var to enable live previews."
    );
  }
  return s;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function sign(data: string): string {
  return b64url(crypto.createHmac("sha256", getSecret()).update(data).digest());
}

export function signPreviewToken(payload: Omit<PreviewTokenPayload, "exp">, ttlMs = 6 * 60 * 60 * 1000): string {
  const full: PreviewTokenPayload = { ...payload, exp: Date.now() + ttlMs };
  const body = b64url(JSON.stringify(full));
  return `${body}.${sign(body)}`;
}

export function verifyPreviewToken(token: string): PreviewTokenPayload | null {
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = sign(body);
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as PreviewTokenPayload;
    if (!payload.uid || !payload.sandboxId || !payload.port || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}