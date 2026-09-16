// app/api/computer/view/route.ts
// Loaded directly as an <iframe src="..."> — so it can't send custom
// auth headers itself. This route does the header-carrying work
// server-side: fetches the real Daytona preview page with the
// skip-warning header (bypassing the interstitial), then serves it back
// with a <base> tag + a small WebSocket-constructor patch so the VNC
// canvas connects straight to the real Daytona host instead of us.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { getSignedPreviewUrl } from "@/lib/computerUse";

const VNC_PORT = 6080;

export async function GET(req: NextRequest) {
  const sandboxId = req.nextUrl.searchParams.get("sandboxId");
  const idToken = req.nextUrl.searchParams.get("token");
  if (!sandboxId || !idToken) {
    return new NextResponse("Missing sandboxId or token.", { status: 400 });
  }

  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    const settingsSnap = await adminDb()
      .collection("users").doc(decoded.uid).collection("settings").doc("integrations").get();
    const apiKey = settingsSnap.exists ? (settingsSnap.data()?.daytonaApiKey as string | undefined) : undefined;
    if (!apiKey) return new NextResponse("No Daytona API key configured.", { status: 400 });

    const signed = await getSignedPreviewUrl(sandboxId, apiKey, VNC_PORT);
    const upstream = await fetch(signed.url, {
      headers: { "X-Daytona-Skip-Preview-Warning": "true" },
    });
    const html = await upstream.text();

    const u = new URL(signed.url);
    const base = `${u.protocol}//${u.host}/`;
    const wsShim = `<script>(function(){var H="${u.host}",P="${u.protocol === "https:" ? "wss:" : "ws:"}";var O=window.WebSocket;window.WebSocket=function(url,protocols){try{var a=new URL(url,location.href);a.host=H;a.protocol=P;url=a.toString();}catch(e){}return protocols!==undefined?new O(url,protocols):new O(url);};window.WebSocket.prototype=O.prototype;})();</script>`;
    const inject = `<base href="${base}">${wsShim}`;

    const headMatch = html.match(/<head[^>]*>/i);
    const finalHtml = headMatch
      ? html.replace(headMatch[0], `${headMatch[0]}${inject}`)
      : inject + html;

    return new NextResponse(finalHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (err) {
    console.error("[api/computer/view]", err);
    const message = err instanceof Error ? err.message : "Failed to load the computer preview.";
    return new NextResponse(message, { status: 500 });
  }
}