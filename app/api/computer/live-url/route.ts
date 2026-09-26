import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { signPreviewToken } from "@/lib/previewToken";

// The iframe itself cannot send Firebase Authorization headers, so this endpoint
// authenticates the caller once and returns a short-lived same-origin preview URL.
// Older clients sometimes sent the Firebase token as ?token=...; keep that path
// working while preferring the Authorization header.
export async function GET(req: NextRequest) {
  const sandboxId = req.nextUrl.searchParams.get("sandboxId");
  if (!sandboxId) return NextResponse.json({ error: "Missing sandboxId." }, { status: 400 });
  try {
    const headerToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const queryToken = req.nextUrl.searchParams.get("token") || "";
    const idToken = headerToken || queryToken;
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);
    const apiKey = await resolveIntegrationSecret(decoded.uid, "daytonaApiKey");
    if (!apiKey) return NextResponse.json({ error: "No Daytona API key." }, { status: 400 });
    const previewToken = signPreviewToken({ uid: decoded.uid, sandboxId, port: 6080 }, 6 * 60 * 60 * 1000);
    return NextResponse.json({ url: `/api/preview/${previewToken}/vnc.html?autoconnect=true&resize=remote&reconnect=true` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to create a computer live URL." }, { status: 500 });
  }
}
