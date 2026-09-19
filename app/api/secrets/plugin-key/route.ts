import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { encryptSecret } from "@/lib/secretsVault";

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);
    const { toolId, apiKey } = await req.json();
    if (!toolId || !apiKey) return NextResponse.json({ error: "toolId and apiKey are required." }, { status: 400 });
    await adminDb().collection("users").doc(decoded.uid).collection("pluginConnections").doc(toolId).set({
      apiKey_enc: encryptSecret(apiKey),
      connectedAt: Date.now(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/secrets/plugin-key]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save." }, { status: 500 });
  }
}