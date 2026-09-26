import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { runAgentJob } from "@/lib/agentRuntime";

export const maxDuration = 300;

async function runForUser(uid: string) {
  const ref = adminDb().collection("users").doc(uid).collection("agentJobs");
  const snap = await ref.where("status", "in", ["queued", "running"]).get();
  let processed = 0;
  for (const d of snap.docs) {
    const j = d.data() as any;
    if (j.status === "queued" || (j.leaseUntil || 0) < Date.now()) {
      await runAgentJob(uid, d.id); processed++;
    }
  }
  return processed;
}

async function handle(req: NextRequest) {
  try {
    const auth = req.headers.get("authorization") || "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
      const all = await adminDb().collectionGroup("agentJobs").where("status", "in", ["queued", "running"]).get();
      const users = new Set<string>();
      all.forEach(d => { const uid = d.ref.parent.parent?.id; if (uid) users.add(uid); });
      let processed = 0; for (const uid of users) processed += await runForUser(uid);
      return NextResponse.json({ ok: true, processed, users: users.size });
    }
    if (!token) return NextResponse.json({ error: "Missing auth." }, { status: 401 });
    const uid = (await adminAuth().verifyIdToken(token)).uid;
    return NextResponse.json({ ok: true, processed: await runForUser(uid) });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Tick failed." }, { status: 500 });
  }
}

export async function POST(req: NextRequest) { return handle(req); }
export async function GET(req: NextRequest) { return handle(req); }
