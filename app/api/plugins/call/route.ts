import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebaseAdmin";
import { runPluginAction } from "@/lib/pluginRuntime";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const idToken = (req.headers.get("authorization") || "").replace("Bearer ", "");
    if (!idToken) return NextResponse.json({ error: "Missing auth token." }, { status: 401 });
    const decoded = await adminAuth().verifyIdToken(idToken);

    const { toolId, actionId, params } = await req.json();
    if (!toolId || !actionId) {
      return NextResponse.json({ error: "toolId and actionId are required." }, { status: 400 });
    }

    const result = await runPluginAction(decoded.uid, toolId, actionId, params || {});
    return NextResponse.json({ ok: true, result });
  } catch (err) {
    console.error("[api/plugins/call]", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Plugin action failed." }, { status: 500 });
  }
}