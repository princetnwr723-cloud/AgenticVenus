// app/api/sandbox/start/route.ts
// Kicks off a real cloud sandbox and returns immediately — the install
// and start command run in the background inside the sandbox. The
// client then polls /api/sandbox/status until the server is actually
// listening (a real npm install can take much longer than this single
// request is allowed to run for).

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { startCloudSandbox } from "@/lib/sandboxRun";

export const maxDuration = 60;

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