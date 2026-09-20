import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import {
  ensureWorkspace,
  workspaceExec,
  workspaceSessionExec,
  workspaceWriteFile,
  workspaceReadFile,
  workspacePreview,
  workspaceListFiles,
  workspaceDelete,
} from "@/lib/workspaceRuntime";

export const maxDuration = 300;

async function uidFrom(req: NextRequest) {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing auth token.");
  return (await adminAuth().verifyIdToken(token)).uid;
}

export async function POST(req: NextRequest) {
  try {
    const uid = await uidFrom(req);
    const body = await req.json();
    const action = body?.action as string;

    if (action === "ensure") return NextResponse.json({ ok: true, workspace: await ensureWorkspace(uid) });
    if (action === "exec") return NextResponse.json({ ok: true, result: await workspaceExec(uid, body.command, body.cwd, body.timeout) });
    if (action === "sessionExec") return NextResponse.json({ ok: true, result: await workspaceSessionExec(uid, body.sessionId || "agenticvenus-terminal", body.command, !!body.runAsync) });
    if (action === "write") return NextResponse.json({ ok: true, result: await workspaceWriteFile(uid, body.path, body.content) });
    if (action === "read") return NextResponse.json({ ok: true, result: await workspaceReadFile(uid, body.path) });
    if (action === "preview") return NextResponse.json({ ok: true, result: await workspacePreview(uid, Number(body.port || 3000)) });
    if (action === "list") return NextResponse.json({ ok: true, ...(await workspaceListFiles(uid, !!body.includeContent)) });
    if (action === "delete") { await workspaceDelete(uid); return NextResponse.json({ ok: true }); }

    return NextResponse.json({ error: "Unknown workspace action." }, { status: 400 });
  } catch (err) {
    console.error("[api/workspace]", err);
    const message = err instanceof Error ? err.message : "Workspace operation failed.";
    const status = message.includes("Missing auth") || message.includes("auth/id-token") ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
