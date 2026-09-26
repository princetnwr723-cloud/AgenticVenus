// app/api/preview/[token]/[[...path]]/route.ts
// Fixes two real bugs found in testing:
//
// 1) THE 502/GARBLED-TEXT BUG. The old code injected the WebSocket shim
//    whenever `!realPath` (i.e. the root request "/"), regardless of what
//    Daytona actually returned. When a dev server hadn't started listening
//    yet (or was still mid-compile on a bigger project), Daytona's own edge
//    returns a small JSON error ({"statusCode":502,...}); the old code still
//    treated that as HTML and glued a raw <script> tag in front of it,
//    which the browser then rendered as literal text — exactly what showed
//    up in Codespace's preview. Fixed: the shim is only injected when the
//    response is ACTUALLY HTML (by real content-type or a .html path).
//
// 2) "WORKS SOMETIMES, NOT WHEN THERE ARE MANY FILES." A bigger project's
//    first `npm run dev`/`vite`/`next dev` can take anywhere from a few
//    seconds to well over a minute to finish its first compile, during
//    which Daytona's proxy answers with 502/503/504. There was no retry, so
//    the first request after starting the server just failed permanently.
//    Fixed: transient 5xx responses are retried for up to ~25s; if it's
//    still not up after that, a small auto-refreshing HTML page is served
//    instead of raw error JSON, so the iframe keeps trying on its own.
//
// This same route also serves the Cloud Computer live view (VNC), which is
// why the WebSocket shim exists at all — noVNC needs it to reach the real
// Daytona host from behind this proxy.

import { NextRequest, NextResponse } from "next/server";
import { verifyPreviewToken } from "@/lib/previewToken";
import { resolveIntegrationSecret } from "@/lib/secretsResolve";
import { getSignedPreviewUrl } from "@/lib/computerUse";

export const maxDuration = 30;

const SKIP_HEADERS = { "X-Daytona-Skip-Preview-Warning": "true" };
const TEXT_LIKE = /\.(html?|css|js|mjs|json|svg|xml|txt|map)$/i;
const RETRY_STATUSES = new Set([502, 503, 504]);
const MAX_RETRIES = 6;
const RETRY_DELAY_MS = 1500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

function startingUpPage(prefix: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="2"><style>
html,body{height:100%;margin:0;background:#111;color:#aaa;font:14px ui-monospace,Menlo,monospace;display:flex;align-items:center;justify-content:center}
.dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#0a84ff;margin-right:8px;animation:p 1s ease-in-out infinite}
@keyframes p{0%,100%{opacity:.3}50%{opacity:1}}
</style></head><body><div><span class="dot"></span>Still starting the server… this page refreshes itself.</div></body></html>`;
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
    const prefix = `/api/preview/${params.token}`;

    let upstream: Response | null = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      upstream = await fetch(upstreamUrl, { headers: SKIP_HEADERS, redirect: "manual" }).catch(() => null);
      if (upstream && !RETRY_STATUSES.has(upstream.status)) break;
      if (attempt < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
    }

    if (!upstream) {
      return new NextResponse("Couldn't reach the cloud workspace. Try again in a few seconds.", { status: 502 });
    }

    if (RETRY_STATUSES.has(upstream.status)) {
      // Still not up after ~10s of retrying — hand back a page that keeps
      // trying on its own instead of a dead error screen.
      return new NextResponse(startingUpPage(prefix), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }

    const contentType = upstream.headers.get("content-type") || "application/octet-stream";

    if (upstream.status >= 300 && upstream.status < 400) {
      const location = upstream.headers.get("location") || "";
      const target = location.startsWith("http")
        ? location
        : new URL(`${prefix}/${location.replace(/^\//, "")}`, req.nextUrl.origin).toString();
      return NextResponse.redirect(target, upstream.status);
    }

    // Only ever treat a response as HTML (and inject the WebSocket shim)
    // when it genuinely IS HTML — never inferred just because the path was
    // the bare root. This is the fix for the garbled-JSON bug.
    const isHtml = /html/i.test(contentType) || /\.html?$/i.test(realPath);
    const isText = isHtml || TEXT_LIKE.test(realPath) || /text|javascript|json|css|xml/.test(contentType);

    if (isText) {
      let text = await upstream.text();
      text = text.replace(/((?:src|href)=["'])\/(?!\/)/g, `$1${prefix}/`);
      text = text.replace(/url\((["']?)\/(?!\/)/g, `url($1${prefix}/`);

      if (isHtml) {
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