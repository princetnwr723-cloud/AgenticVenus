import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { getAgentJob } from "@/lib/agentRuntime";

async function uidFrom(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing auth token.");
  return (await adminAuth().verifyIdToken(token)).uid;
}

export async function GET(req: NextRequest) {
  try {
    const uid = await uidFrom(req);
    const id = req.nextUrl.searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing job id." }, { status: 400 });
    const job = await getAgentJob(uid, id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json({ ok: true, job });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 401 });
  }
}
