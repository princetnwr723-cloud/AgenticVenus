// app/api/computer/view/[...path]/route.ts
// Full reverse-proxy for the Daytona desktop preview. URL shape:
// /api/computer/view/{sandboxId}/{idToken}/{realPath...}
// The warning page shows regardless of auth type (confirmed by testing
// a raw signed URL directly) — so proxying every request server-side
// with the skip-header is mandatory, not optional.

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebaseAdmin";
import { getSignedPreviewUrl } from "@/lib/computerUse";

const VNC_PORT = 6080;
const TEXT_LIKE = /\.(html?|css|js|mjs|json|svg|xml|txt)$/i;
const SKIP_HEADERS = { "X-Daytona-Skip-Preview-Warning": "true" };

async function discoverEntryPath(base: string): Promise<string> {
  try {
    const res = await fetch(`${base}/`, { headers: SKIP_HEADERS });
    const html = await res.text();
    const match = html.match(/href=["']([^"']*vnc[^"']*\.html[^"']*)["']/i);
    if (match) return match[1];
  } catch {
    // fall through
  }
  return "vnc.html?autoconnect=true&resize=remote&reconnect=true";
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  const segments = params.path || [];
  if (segments.length < 2) return new NextResponse("Bad request.", { status: 400 });
  const [sandboxId, token, ...rest] = segments;

  try {
    const decoded = await adminAuth().verifyIdToken(token);
    const settingsSnap = await adminDb()
      .collection("users").doc(decoded.uid).collection("settings").doc("integrations").get();
    const apiKey = settingsSnap.exists ? (settingsSnap.data()?.daytonaApiKey as string | undefined) : undefined;
    if (!apiKey) return new NextResponse("No Daytona API key configured.", { status: 400 });

    const signed = await getSignedPreviewUrl(sandboxId, apiKey, VNC_PORT);
    const base = signed.url.replace(/\/$/, "");
    const realPath = rest.length ? rest.join("/") : await discoverEntryPath(base);

    const upstream = await fetch(`${base}/${realPath.replace(/^\//, "")}`, { headers: SKIP_HEADERS });
    const prefix = `/api/computer/view/${sandboxId}/${token}`;
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";
    const pathOnly = realPath.split("?")[0];
    const isText = TEXT_LIKE.test(pathOnly) || /text|javascript|json|html/.test(contentType);

    if (isText) {
      let text = await upstream.text();
      text = text.replace(/((?:src|href)=["'])\/(?!\/)/g, `$1${prefix}/`);
      text = text.replace(/url\((["']?)\/(?!\/)/g, `url($1${prefix}/`);

      if (/\.html?$/i.test(pathOnly)) {
        const u = new URL(base);
        // DEBUG: shows a live-updating log of every WebSocket connect
        // attempt right on the page — remove this banner once VNC works.
        const wsShim = `<script>(function(){
var H="${u.host}",P="${u.protocol === "https:" ? "wss:" : "ws:"}";
var O=window.WebSocket;
var banner=document.createElement("div");
banner.style.cssText="position:fixed;top:0;left:0;right:0;z-index:999999;background:#000;color:#0f0;font:11px monospace;padding:4px;max-height:90px;overflow:auto;white-space:pre-wrap;";
function attach(){ if(document.body) document.body.appendChild(banner); else setTimeout(attach,50); }
attach();
function log(m){ banner.textContent += m + "\\n"; }
window.WebSocket=function(url,protocols){
  var orig=url;
  try{ var a=new URL(url,location.href); a.host=H; a.protocol=P; url=a.toString(); }catch(e){ log("rewrite err: "+e); }
  log("WS -> "+url+" (orig: "+orig+")");
  var ws=protocols!==undefined?new O(url,protocols):new O(url);
  ws.addEventListener("open",function(){ log("WS OPEN"); });
  ws.addEventListener("error",function(){ log("WS ERROR"); });
  ws.addEventListener("close",function(e){ log("WS CLOSE code="+e.code+" reason="+e.reason); });
  return ws;
};
window.WebSocket.prototype=O.prototype;
})();</script>`;
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