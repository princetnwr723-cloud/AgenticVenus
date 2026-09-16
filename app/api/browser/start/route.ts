import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { startBrowserSession } from "@/lib/browserUse";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const settingsSnap = await adminDb()
      .collection("users").doc(decoded.uid).collection("settings").doc("integrations").get();
    const apiKey = settingsSnap.exists ? (settingsSnap.data()?.browserlessApiKey as string | undefined) : undefined;
    if (!apiKey) {
      return NextResponse.json({ error: "No Browserless API key — add yours in Settings → Integrations." }, { status: 400 });
    }

    const result = await startBrowserSession(decoded.uid, apiKey);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/browser/start]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to start the browser." }, { status: 500 });
  }
}