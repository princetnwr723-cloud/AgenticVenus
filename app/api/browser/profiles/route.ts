import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";

const REGION = "production-sfo.browserless.io";

export async function GET(req: NextRequest) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(token);
    const apiKey = await resolveIntegrationSecret(decoded.uid, "browserlessApiKey");
    if (!apiKey) return NextResponse.json({ error: "No Browserless API key configured." }, { status: 400 });
    const res = await fetch(`https://${REGION}/profiles?token=${encodeURIComponent(apiKey)}`, { cache: "no-store" });
    const data = await res.json().catch(() => []);
    if (!res.ok) return NextResponse.json({ error: data?.error || "Could not list Browserless profiles." }, { status: res.status });
    return NextResponse.json({ profiles: Array.isArray(data) ? data : data?.profiles || [] });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not list Browserless profiles." }, { status: 500 });
  }
}
