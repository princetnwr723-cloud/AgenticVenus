// app/api/computer/view/route.ts
// Loaded as iframe src. Daytona's base preview URL is a directory
// listing (vnc.html, vnc_lite.html, etc.) — so we skip that entirely and
// fetch vnc.html directly with autoconnect, server-side, with the
// skip-warning header (which the iframe itself could never send). Then
// inject a <base> tag + a WebSocket patch so the VNC canvas connects
// straight to the real Daytona host instead of us.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { getSignedPreviewUrl } from "@/lib/computerUse";

const VNC_PORT = 6080;
const VNC_ENTRY = "vnc.html?autoconnect=true&resize=remote&reconnect=true";

export async function GET(req: NextRequest) {
  const sandboxId = req.nextUrl.searchParams.get("sandboxId");
  const idToken = req.nextUrl.searchParams.get("token");
  if (!sandboxId || !idToken) return new NextResponse("Missing sandboxId or token.", { status: 400 });

  try {
    const decoded = await adminAuth().verifyIdToken(idToken);
    const settingsSnap = await adminDb()
      .collection("users").doc(decoded.uid).collection("settings").doc("integrations").get();
    const apiKey = settingsSnap.exists ? (settingsSnap.data()?.daytonaApiKey as string | undefined) : undefined;
    if (!apiKey) return new NextResponse("No Daytona API key configured.", { status: 400 });

    const signed = await getSignedPreviewUrl(sandboxId, apiKey, VNC_PORT);
    const base = signed.url.replace(/\/$/, "");
    const entryUrl = `${base}/${VNC_ENTRY}`;

    const upstream = await fetch(entryUrl, { headers: { "X-Daytona-Skip-Preview-Warning": "true" } });
    if (!upstream.ok) {
      return new NextResponse(
        `Couldn't load the desktop (status ${upstream.status}) — the sandbox may still be starting up, try again in a few seconds.`,
        { status: 502 }
      );
    }
    const html = await upstream.text();

    const u = new URL(base + "/");
    const wsShim = `<script>(function(){var H="${u.host}",P="${u.protocol === "https:" ? "wss:" : "ws:"}";var O=window.WebSocket;window.WebSocket=function(url,protocols){try{var a=new URL(url,location.href);a.host=H;a.protocol=P;url=a.toString();}catch(e){}return protocols!==undefined?new O(url,protocols):new O(url);};window.WebSocket.prototype=O.prototype;})();</script>`;
    const inject = `<base href="${u.toString()}">${wsShim}`;

    const headMatch = html.match(/<head[^>]*>/i);
    const finalHtml = headMatch ? html.replace(headMatch[0], `${headMatch[0]}${inject}`) : inject + html;

    return new NextResponse(finalHtml, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (err) {
    console.error("[api/computer/view]", err);
    return new NextResponse(err instanceof Error ? err.message : "Failed to load the computer preview.", { status: 500 });
  }
}