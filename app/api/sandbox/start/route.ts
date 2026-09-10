// app/api/sandbox/start/route.ts
// Spins up a real E2B cloud sandbox, writes the Developer Agent's files
// into it, runs the project's real start command, and returns a live
// preview URL — this is what lets Codespace preview ANY language, not
// just what a browser iframe can render.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { startCloudSandbox } from "@/lib/sandboxRun";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    await adminAuth().verifyIdToken(idToken);

    const { files } = await req.json();
    if (!Array.isArray(files) || files.length === 0) {
      return NextResponse.json({ error: "No files to run." }, { status: 400 });
    }

    const result = await startCloudSandbox(files);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/sandbox/start]", err);
    const message = err instanceof Error ? err.message : "Failed to start the cloud sandbox.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}