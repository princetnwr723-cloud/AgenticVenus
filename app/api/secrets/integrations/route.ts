import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { encryptSecret } from "@/lib/secretsVault";
import { getIntegrationPresence, INTEGRATION_FIELDS, type IntegrationField } from "@/lib/secretsResolve";

async function requireUid(req: NextRequest): Promise<string> {
  const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!idToken) throw new Error("Missing auth token.");
  const decoded = await adminAuth().verifyIdToken(idToken);
  return decoded.uid;
}

export async function GET(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const presence = await getIntegrationPresence(uid);
    return NextResponse.json({ ok: true, presence });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const { field, value } = (await req.json()) as { field: IntegrationField; value: string };
    if (!INTEGRATION_FIELDS.includes(field)) return NextResponse.json({ error: "Unknown field." }, { status: 400 });
    if (!value || typeof value !== "string") return NextResponse.json({ error: "value is required." }, { status: 400 });

    const enc = encryptSecret(value);
    await adminDb().collection("users").doc(uid).collection("settings").doc("integrations").set(
      { [`${field}_enc`]: enc, [`${field}_updatedAt`]: Date.now() },
      { merge: true }
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/secrets/integrations POST]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to save." }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const uid = await requireUid(req);
    const { field } = (await req.json()) as { field: IntegrationField };
    if (!INTEGRATION_FIELDS.includes(field)) return NextResponse.json({ error: "Unknown field." }, { status: 400 });
    await adminDb().collection("users").doc(uid).collection("settings").doc("integrations").update({
      [`${field}_enc`]: FieldValue.delete(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/secrets/integrations DELETE]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to remove." }, { status: 500 });
  }
}