import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { parseSkillMd } from "@/lib/skillImport";

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    await adminAuth().verifyIdToken(idToken);

    const { url } = await req.json();
    if (!url) return NextResponse.json({ error: "url is required." }, { status: 400 });

    let fetchUrl = url as string;
    // A GitHub "blob" link points at the HTML viewer page, not the raw
    // file — rewrite it to raw.githubusercontent.com automatically.
    const ghMatch = fetchUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/);
    if (ghMatch) {
      fetchUrl = `https://raw.githubusercontent.com/${ghMatch[1]}/${ghMatch[2]}/${ghMatch[3]}`;
    }

    const res = await fetch(fetchUrl);
    if (!res.ok) return NextResponse.json({ error: `Couldn't fetch that link (status ${res.status}).` }, { status: 400 });
    const text = await res.text();
    if (text.length > 50_000) return NextResponse.json({ error: "That file is too large for a skill." }, { status: 400 });

    const parsed = parseSkillMd(text);
    return NextResponse.json({ ok: true, ...parsed });
  } catch (err) {
    console.error("[api/skills/import]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to import skill." }, { status: 500 });
  }
}