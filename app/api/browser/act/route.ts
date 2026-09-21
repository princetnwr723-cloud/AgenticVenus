import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { runBrowserAction, type BrowserAction } from "@/lib/browserUse";

// A page load + settle + screenshot + element scan can take longer than 30s.
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { sessionId, action } = (await req.json()) as { sessionId: string; action: BrowserAction };
    if (!sessionId || !action) return NextResponse.json({ error: "sessionId and action are required." }, { status: 400 });

    const apiKey = await resolveIntegrationSecret(decoded.uid, "browserlessApiKey");
    if (!apiKey) return NextResponse.json({ error: "No Browserless API key configured." }, { status: 400 });

    const result = await runBrowserAction(decoded.uid, sessionId, action, apiKey);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/browser/act]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Browser action failed." }, { status: 500 });
  }
}