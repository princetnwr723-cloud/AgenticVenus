import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { encryptSecret, decryptSecret } from "@/lib/secretsVault";

async function requireUid(req: NextRequest): Promise<string> {
  const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!idToken) throw new Error("Missing auth token.");
  const decoded = await adminAuth().verifyIdToken(idToken);
  return decoded.uid;
}

export async function GET(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const snap = await adminDb().collection("users").doc(uid).collection("connections").get();
    const connections = snap.docs
      .map((d) => {
        const data = d.data();
        let apiKey = "";
        try {
          apiKey = data.apiKey_enc ? decryptSecret(data.apiKey_enc) : "";
        } catch (err) {
          console.error(`[secrets/connections] decrypt failed for ${uid}/${d.id}:`, err);
        }
        return { providerId: d.id, apiKey, model: data.model as string | undefined, connectedAt: data.connectedAt || 0 };
      })
      .filter((c) => c.apiKey);
    return NextResponse.json({ ok: true, connections });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const { providerId, providerName, apiKey } = await req.json();
    if (!providerId || !apiKey) return NextResponse.json({ error: "providerId and apiKey are required." }, { status: 400 });
    await adminDb().collection("users").doc(uid).collection("connections").doc(providerId).set(
      { providerId, providerName, apiKey_enc: encryptSecret(apiKey), connectedAt: Date.now() },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/secrets/connections POST]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save." }, { status: 500 });
  }
}