// app/api/sandbox/stop/route.ts
// Kills a running cloud sandbox early to keep costs down.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { stopCloudSandbox } from "@/lib/sandboxRun";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    await adminAuth().verifyIdToken(idToken);

    const { sandboxId } = await req.json();
    if (!sandboxId) return NextResponse.json({ error: "sandboxId is required." }, { status: 400 });

    await stopCloudSandbox(sandboxId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/sandbox/stop]", err);
    return NextResponse.json({ ok: true });
  }
}