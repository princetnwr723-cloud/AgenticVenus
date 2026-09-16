import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { stopBrowserSession } from "@/lib/browserUse";

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);
    const { sessionId } = await req.json();
    if (!sessionId) return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
    await stopBrowserSession(decoded.uid, sessionId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/browser/stop]", err);
    return NextResponse.json({ ok: true });
  }
}