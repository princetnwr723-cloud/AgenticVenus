// app/api/preview/[token]/[[...path]]/route.ts
// Fixes the "Preview URL Warning" interstitial appearing INSIDE Codespace's
// live-preview iframe and the Cloud Computer live view: both used to hand
// the browser Daytona's raw signed preview URL directly, so Daytona's own
// click-through warning page rendered inside the iframe instead of the real
// app/desktop. This route fetches Daytona's preview with the
// X-Daytona-Skip-Preview-Warning header server-side (which is exactly what
// that header is for) and streams the real content back same-origin, so the
// warning never appears — no click needed.
//
// Auth: a short-lived signed token (lib/previewToken.ts) instead of a
// Firebase ID token, because an <iframe src> can't send an Authorization
// header. The token is scoped to one (uid, sandboxId, port) and expires.
//
// This proxies plain HTTP assets (HTML/CSS/JS/images). It cannot proxy a
// WebSocket itself (Vercel serverless functions don't hold one open), so any
// HTML response gets a small shim that redirects WebSocket connections
// straight to the real Daytona host — this is what makes noVNC (Cloud
// Computer) and a dev server's HMR socket keep working through the proxy.

import { NextRequest, NextResponse } from "next/server";
import { verifyPreviewToken } from "@/lib/previewToken";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { getSignedPreviewUrl } from "@/lib/computerUse";

export const maxDuration = 30;

const SKIP_HEADERS = { "X-Daytona-Skip-Preview-Warning": "true" };
const TEXT_LIKE = /\.(html?|css|js|mjs|json|svg|xml|txt|map)$/i;

// Per-instance cache so a page with many assets doesn't re-resolve the
// signed Daytona URL on every single request. Best-effort only — serverless
// instances are ephemeral and there can be several running at once.
const cache = new Map<string, { url: string; exp: number }>();

async function resolveBaseUrl(uid: string, sandboxId: string, port: number): Promise<string> {
  const key = `${uid}:${sandboxId}:${port}`;
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return hit.url;

  const apiKey = await resolveIntegrationSecret(uid, "daytonaApiKey");
  if (!apiKey) throw new Error("Daytona isn't connected anymore — reconnect it in Settings → Integrations.");
  const signed = await getSignedPreviewUrl(sandboxId, apiKey, port);
  const url = signed.url.replace(/\/$/, "");
  cache.set(key, { url, exp: Date.now() + 55_000 });
  return url;
}

export async function GET(req: NextRequest, { params }: { params: { token: string; path?: string[] } }) {
  const payload = verifyPreviewToken(params.token);
  if (!payload) {
    return new NextResponse("This preview link expired — reopen it from Codespace or the live view.", { status: 401 });
  }

  try {
    const base = await resolveBaseUrl(payload.uid, payload.sandboxId, payload.port);
    const realPath = (params.path || []).join("/");
    const upstreamUrl = `${base}/${realPath}${req.nextUrl.search}`;

    const upstream = await fetch(upstreamUrl, { headers: SKIP_HEADERS, redirect: "manual" });
    const prefix = `/api/preview/${params.token}`;
    const contentType = upstream.headers.get("content-type") || "application/octet-stream";

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location") || "";
      const target = location.startsWith("http")
        ? location
        : new URL(`${prefix}/${location.replace(/^\//, "")}`, req.nextUrl.origin).toString();
      return NextResponse.redirect(target, upstream.status);
    }

    const isText = TEXT_LIKE.test(realPath) || /text|javascript|json|html|css|xml/.test(contentType);

    if (isText) {
      let text = await upstream.text();
      text = text.replace(/((?:src|href)=["'])\/(?!\/)/g, `$1${prefix}/`);
      text = text.replace(/url\((["']?)\/(?!\/)/g, `url($1${prefix}/`);

      if (/html/i.test(contentType) || /\.html?$/i.test(realPath) || !realPath) {
        const u = new URL(base);
        const wsShim = `<script>(function(){
var H="${u.host}",P="${u.protocol === "https:" ? "wss:" : "ws:"}",PFX=${JSON.stringify(prefix)};
var O=window.WebSocket;
window.WebSocket=function(url,protocols){
  try{
    var a=new URL(url,location.href);
    var p=a.pathname;
    if(p.indexOf(PFX)===0) p=p.slice(PFX.length);
    a.host=H; a.protocol=P; a.pathname=p;
    url=a.toString();
  }catch(e){}
  return protocols!==undefined?new O(url,protocols):new O(url);
};
window.WebSocket.prototype=O.prototype;
})();</script>`;
        text = /<head[^>]*>/i.test(text) ? text.replace(/<head[^>]*>/i, (m) => `${m}${wsShim}`) : wsShim + text;
      }
      return new NextResponse(text, { headers: { "content-type": contentType, "cache-control": "no-store" } });
    }

    const buf = await upstream.arrayBuffer();
    return new NextResponse(buf, { headers: { "content-type": contentType, "cache-control": "no-store" } });
  } catch (err) {
    console.error("[api/preview]", err);
    return new NextResponse(err instanceof Error ? err.message : "Failed to load the preview.", { status: 500 });
  }
}