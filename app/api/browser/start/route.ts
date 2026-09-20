import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { startBrowserSession } from "@/lib/browserUse";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const apiKey = await resolveIntegrationSecret(decoded.uid, "browserlessApiKey");
    if (!apiKey) {
      return NextResponse.json({ error: "No Browserless API key — add yours in Settings → Integrations." }, { status: 400 });
    }

    const body = await req.json().catch(() => ({}));
    const profileName = typeof body?.profileName === "string" ? body.profileName.trim() : undefined;
    const result = await startBrowserSession(decoded.uid, apiKey, profileName || undefined);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/browser/start]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to start the browser." }, { status: 500 });
  }
}