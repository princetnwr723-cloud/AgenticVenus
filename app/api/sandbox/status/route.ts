// app/api/sandbox/status/route.ts
// Polled by the client every few seconds after starting a sandbox, to
// check whether the server is actually listening yet on port 3000.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { checkSandboxStatus } from "@/lib/sandboxRun";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    await adminAuth().verifyIdToken(idToken);

    const { sandboxId } = await req.json();
    if (!sandboxId) return NextResponse.json({ error: "sandboxId is required." }, { status: 400 });

    const result = await checkSandboxStatus(sandboxId);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/sandbox/status]", err);
    const message = err instanceof Error ? err.message : "Failed to check sandbox status.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}