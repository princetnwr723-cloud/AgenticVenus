// app/api/computer/view/[...path]/route.ts
// Full reverse-proxy for the Daytona desktop preview. URL shape:
// /api/computer/view/{sandboxId}/{idToken}/{realPath...}
// Putting sandboxId+token IN the path (not as query params) is what
// fixes broken icons/CSS — every relative AND root-absolute resource
// reference the browser requests naturally stays under this same
// prefix, so it always comes back through us instead of 404ing at our
// own domain's root.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { getSignedPreviewUrl } from "@/lib/computerUse";

const VNC_PORT = 6080;
const TEXT_LIKE = /\.(html?|css|js|mjs|json|svg|xml|txt)$/i;

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const segments = params.path || [];
  if (segments.length < 2) return new NextResponse("Bad request.", { status: 400 });
  const [sandboxId, token, ...rest] = segments;
  const realPath = rest.length ? rest.join("/") : "vnc.html";

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const settingsSnap = await adminDb()
      .collection("users").doc(decoded.uid).collection("settings").doc("integrations").get();
    const apiKey = settingsSnap.exists ? (settingsSnap.data()?.daytonaApiKey as string | undefined) : undefined;
    if (!apiKey) return new NextResponse("No Daytona API key configured.", { status: 400 });

    const signed = await getSignedPreviewUrl(sandboxId, apiKey, VNC_PORT);
    const base = signed.url.replace(/\/$/, "");
    const query = realPath === "vnc.html" ? "?autoconnect=true&resize=remote&reconnect=true" : "";
    const upstream = await fetch(`${base}/${realPath}${query}`, {
      headers: { "X-Daytona-Skip-Preview-Warning": "true" },
    });

    const prefix = `/api/computer/view/${sandboxId}/${token}`;
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const isText = TEXT_LIKE.test(realPath) || /text|javascript|json|html/.test(contentType);

    if (isText) {
      let text = await upstream.text();
      // Root-absolute references ("/app/x.png") get pulled back under
      // our prefix; genuinely relative ones already resolve correctly
      // on their own since the whole path structure is preserved.
      text = text.replace(/((?:src|href)=["'])\/(?!\/)/g, `$1${prefix}/`);
      text = text.replace(/url\((["']?)\/(?!\/)/g, `url($1${prefix}/`);

      if (/\.html?$/i.test(realPath)) {
        const u = new URL(base);
        const wsShim = `<script>(function(){var H="${u.host}",P="${u.protocol === "https:" ? "wss:" : "ws:"}";var O=window.WebSocket;window.WebSocket=function(x,p){try{var a=new URL(x,location.href);a.host=H;a.protocol=P;x=a.toString();}catch(e){}return p!==undefined?new O(x,p):new O(x);};window.WebSocket.prototype=O.prototype;})();</script>`;
        text = text.replace(/<head[^>]*>/i, (m) => `${m}${wsShim}`);
      }
      return new NextResponse(text, { headers: { "content-type": contentType } });
    }

    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, { headers: { "content-type": contentType } });
  } catch (err) {
    console.error("[api/computer/view]", err);
    return new NextResponse(err instanceof Error ? err.message : "Failed to load resource.", { status: 500 });
  }
}