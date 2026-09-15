// app/api/computer/stop/route.ts
import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { stopComputer } from "@/lib/computerUse";

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { sandboxId } = await req.json();
    if (!sandboxId) return NextResponse.json({ error: "sandboxId is required." }, { status: 400 });

    const settingsSnap = await adminDb()
      .collection("users").doc(decoded.uid).collection("settings").doc("integrations").get();
    const apiKey = settingsSnap.exists ? (settingsSnap.data()?.daytonaApiKey as string | undefined) : undefined;
    if (apiKey) await stopComputer(sandboxId, apiKey);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[api/computer/stop]", err);
    return NextResponse.json({ ok: true });
  }
}