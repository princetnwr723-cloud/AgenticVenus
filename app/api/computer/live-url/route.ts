import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { signPreviewToken } from "@/lib/previewToken";

export async function GET(req: NextRequest) {
  const sandboxId = req.nextUrl.searchParams.get("sandboxId");
  const token = req.nextUrl.searchParams.get("token");
  if (!sandboxId || !token) return NextResponse.json({ error: "Missing params." }, { status: 400 });
  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const apiKey = await resolveIntegrationSecret(decoded.uid, "daytonaApiKey");
    if (!apiKey) return NextResponse.json({ error: "No Daytona API key." }, { status: 400 });
    const previewToken = signPreviewToken({ uid: decoded.uid, sandboxId, port: 6080 });
    return NextResponse.json({ url: `/api/preview/${previewToken}/vnc.html?autoconnect=true&resize=remote` });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed." }, { status: 500 });
  }
}