// app/api/computer/act/route.ts
// Executes one action (click, type, screenshot, etc.) on a running
// cloud computer and returns a fresh screenshot.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { runComputerAction, type ComputerAction } from "@/lib/computerUse";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  try {
    const authHeaderIn = req.headers.get("authorization") || "";
    const idToken = authHeaderIn.replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { sandboxId, action } = (await req.json()) as { sandboxId: string; action: ComputerAction };
    if (!sandboxId || !action) {
      return NextResponse.json({ error: "sandboxId and action are required." }, { status: 400 });
    }

    const settingsSnap = await adminDb()
      .collection("users").doc(decoded.uid).collection("settings").doc("integrations").get();
    const apiKey = settingsSnap.exists ? (settingsSnap.data()?.daytonaApiKey as string | undefined) : undefined;
    if (!apiKey) return NextResponse.json({ error: "No Daytona API key configured." }, { status: 400 });

    const result = await runComputerAction(sandboxId, apiKey, action);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[api/computer/act]", err);
    const message = err instanceof Error ? err.message : "Computer action failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}