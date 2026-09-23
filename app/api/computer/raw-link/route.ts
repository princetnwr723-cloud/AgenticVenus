import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { signPreviewToken } from "@/lib/previewToken";

const VNC_PORT = 6080;

export async function GET(req: NextRequest) {
  const sandboxId = req.nextUrl.searchParams.get("sandboxId");
  if (!sandboxId) return NextResponse.json({ error: "Missing sandboxId." }, { status: 400 });
  try {
    const idToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const uid = (await adminAuth().verifyIdToken(idToken)).uid;
    const apiKey = await resolveIntegrationSecret(uid, "daytonaApiKey");
    if (!apiKey) return NextResponse.json({ error: "No Daytona API key configured." }, { status: 400 });

    // Same-origin proxy that skips Daytona's click-through warning — this is
    // what the live-view iframe actually loads now, instead of Daytona's raw
    // signed URL (which showed the warning page inside the iframe).
    const token = signPreviewToken({ uid, sandboxId, port: VNC_PORT });
    const url = `/api/preview/${token}/vnc.html?autoconnect=true&resize=remote&reconnect=true`;
    return NextResponse.json({ url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create a computer live URL." }, { status: 500 });
  }
}