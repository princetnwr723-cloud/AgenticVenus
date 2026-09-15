// app/api/computer/start/route.ts
// Starts a real cloud computer (Daytona VM, top specs by default) for
// the agent to use, and returns a live view URL the user can watch.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { startComputer } from "@/lib/computerUse";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const settingsSnap = await adminDb()
      .collection("users").doc(decoded.uid).collection("settings").doc("integrations").get();
    const apiKey = settingsSnap.exists ? (settingsSnap.data()?.daytonaApiKey as string | undefined) : undefined;
    if (!apiKey) {
      return NextResponse.json(
        { error: "No Daytona API key — add yours in Settings → Integrations to use the cloud computer." },
        { status: 400 }
      );
    }

    const result = await startComputer(apiKey);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/computer/start]", err);
    const message = err instanceof Error ? err.message : "Failed to start the cloud computer.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}