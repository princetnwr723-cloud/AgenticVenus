import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { publishToVercel, publishToNetlify } from "@/lib/publish";
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

    if (target === "vercel") {
      const token = await resolveIntegrationSecret(decoded.uid, "vercelApiToken");
      if (!token) return NextResponse.json({ error: "No Vercel API token — add yours in Settings → Integrations." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await publishToVercel(files, token, name)) });
    }
    if (target === "netlify") {
      const token = await resolveIntegrationSecret(decoded.uid, "netlifyApiToken");
      if (!token) return NextResponse.json({ error: "No Netlify API token — add yours in Settings → Integrations." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await publishToNetlify(files, token, name)) });
    }
    return NextResponse.json({ error: "Unknown publish target." }, { status: 400 });
  } catch (err) {
    console.error("[api/publish]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Publish failed." }, { status: 500 });
  }
}