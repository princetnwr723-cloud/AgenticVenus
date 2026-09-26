import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { startComputer } from "@/lib/computerUse";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const apiKey = await resolveIntegrationSecret(decoded.uid, "daytonaApiKey");
    if (!apiKey) {
      return NextResponse.json({ error: "No Daytona API key — add yours in Settings → Integrations." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const result = await startComputer(apiKey, { uid: decoded.uid, scope: typeof body?.scope === "string" ? body.scope : "primary", gpu: !!body?.gpu });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/computer/start]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to start the cloud computer." }, { status: 500 });
  }
}