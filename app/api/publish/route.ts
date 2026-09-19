import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { publishToVercel, publishToNetlify } from "@/lib/publish";
import { verifyPublishedUrl } from "@/lib/verification";
import type { CodeFile } from "@/lib/codeExtract";

export const maxDuration = 60;

function slugify(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "agenticvenus-project";
}

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { target, files, projectName } = (await req.json()) as { target: "vercel" | "netlify"; files: CodeFile[]; projectName?: string };
    if (!target || !files?.length) return NextResponse.json({ error: "target and files are required." }, { status: 400 });

    const name = slugify(projectName || "agenticvenus-project");
    let result: { url: string };

    if (target === "vercel") {
      const token = await resolveIntegrationSecret(decoded.uid, "vercelApiToken");
      if (!token) return NextResponse.json({ error: "No Vercel API token — add yours in Settings → Integrations." }, { status: 400 });
      result = await publishToVercel(files, token, name);
    } else if (target === "netlify") {
      const token = await resolveIntegrationSecret(decoded.uid, "netlifyApiToken");
      if (!token) return NextResponse.json({ error: "No Netlify API token — add yours in Settings → Integrations." }, { status: 400 });
      result = await publishToNetlify(files, token, name);
    } else {
      return NextResponse.json({ error: "Unknown publish target." }, { status: 400 });
    }

    // Self-verification: actually fetch the URL before calling this a
    // success — a deployment "created" isn't the same as a page "live".
    const verification = await verifyPublishedUrl(result.url);

    return NextResponse.json({
      ok: true,
      url: result.url,
      verified: verification.verified,
      verificationReason: verification.reason,
    });
  } catch (err) {
    console.error("[api/publish]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Publish failed." }, { status: 500 });
  }
}