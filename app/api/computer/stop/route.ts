import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { stopComputer } from "@/lib/computerUse";

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { sandboxId } = await req.json();
    if (!sandboxId) return NextResponse.json({ error: "sandboxId is required." }, { status: 400 });

    const apiKey = await resolveIntegrationSecret(decoded.uid, "daytonaApiKey");
    if (apiKey) await stopComputer(sandboxId, apiKey, decoded.uid);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/computer/stop]", err);
    return NextResponse.json({ ok: true });
  }
}