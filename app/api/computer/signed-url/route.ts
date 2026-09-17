import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { getSignedPreviewUrl } from "@/lib/computerUse";

export async function GET(req: NextRequest) {
  const sandboxId = req.nextUrl.searchParams.get("sandboxId");
  const token = req.nextUrl.searchParams.get("token");
  if (!sandboxId || !token) return NextResponse.json({ error: "Missing params." }, { status: 400 });
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const settingsSnap = await adminDb().collection("users").doc(decoded.uid).collection("settings").doc("integrations").get();
    const apiKey = settingsSnap.exists ? (settingsSnap.data()?.daytonaApiKey as string | undefined) : undefined;
    if (!apiKey) return NextResponse.json({ error: "No Daytona API key." }, { status: 400 });
    const signed = await getSignedPreviewUrl(sandboxId, apiKey, 6080);
    return NextResponse.json({ url: `${signed.url}/vnc.html?autoconnect=true&resize=remote` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}