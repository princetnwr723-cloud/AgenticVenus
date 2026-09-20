import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { getSignedPreviewUrl } from "@/lib/computerUse";

export async function GET(req: NextRequest) {
  const sandboxId = req.nextUrl.searchParams.get("sandboxId");
  if (!sandboxId) return NextResponse.json({ error: "Missing sandboxId." }, { status: 400 });
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const uid = (await adminAuth().verifyIdToken(token)).uid;
    const apiKey = await resolveIntegrationSecret(uid, "daytonaApiKey");
    if (!apiKey) return NextResponse.json({ error: "No Daytona API key configured." }, { status: 400 });
    const signed = await getSignedPreviewUrl(sandboxId, apiKey, 6080, 3600);
    return NextResponse.json({ url: `${signed.url.replace(/\/$/, "")}/vnc.html?autoconnect=true&resize=remote&reconnect=true` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create live computer URL." }, { status: 500 });
  }
}
