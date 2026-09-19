import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { runComputerAction, type ComputerAction } from "@/lib/computerUse";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { sandboxId, action } = (await req.json()) as { sandboxId: string; action: ComputerAction };
    if (!sandboxId || !action) return NextResponse.json({ error: "sandboxId and action are required." }, { status: 400 });

    const apiKey = await resolveIntegrationSecret(decoded.uid, "daytonaApiKey");
    if (!apiKey) return NextResponse.json({ error: "No Daytona API key configured." }, { status: 400 });

    const result = await runComputerAction(sandboxId, apiKey, action);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/computer/act]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Computer action failed." }, { status: 500 });
  }
}