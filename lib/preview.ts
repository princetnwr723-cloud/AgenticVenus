// lib/preview.ts
// Builds a single, self-contained HTML document out of whatever code files the
// Developer Agent wrote, so Codespace can show a live preview — HTML/CSS/JS as
// a real page, React/JSX via a React+Babel CDN shell, and Three.js/3D scenes.
//
// 3D FIXES
//  - The old shell loaded three@0.160 "examples/js/*" scripts. Those files were
//    REMOVED from three.js in r148, so GLTFLoader / OrbitControls were
//    undefined and every 3D site broke. Classic (global `THREE`) mode now uses
//    r147, the last release that still ships them.
//  - Modern code (`import * as THREE from "three"`) is supported through an
//    import map (r160) — the preferred style for new projects.
//  - Local <script src>/<link href> tags that point at project files are inlined
//    in place, so the preview matches what the published site will do.
//  - The iframe is sandboxed WITHOUT allow-same-origin (see CodespacePanel), so
//    generated code can't read the app's login/session storage. A tiny shim
//    keeps localStorage-using demos working, and runtime errors are shown in an
//    overlay and reported to the panel.
//
// Binary assets the user attached (3D models, textures) are baked in as
// `window.AGENTICVENUS_ASSETS['filename']` URLs.

import type { CodeFile } from "@/lib/codeExtract";
import type { Attachment } from "@/lib/chatClient";

const THREE_CLASSIC = "https://cdn.jsdelivr.net/npm/three@0.147.0";
const THREE_MODULE = "https://cdn.jsdelivr.net/npm/three@0.160.0";

function extOf(file: CodeFile): string {
  const match = file.filename.match(/\.(\w+)$/);
  return (match ? match[1] : file.language).toLowerCase();
}

function assetsScript(assets: Attachment[]): string {
  if (assets.length === 0) return "";
  const entries = assets.map((a) => `  ${JSON.stringify(a.name)}: ${JSON.stringify(a.dataUrl)}`).join(",\n");
  return `<script>
window.AGENTICVENUS_ASSETS = (function() {
  const sources = {\n${entries}\n  };
  const out = {};
  for (const name in sources) {
    const src = sources[name];
    if (src.startsWith("data:")) {
      try {
        const [meta, b64] = src.split(",");
        const mime = meta.match(/data:(.*?);base64/)[1];
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        out[name] = URL.createObjectURL(new Blob([bytes], { type: mime }));
      } catch (e) { console.error("Failed to load asset", name, e); }
    } else {
      out[name] = src; // hosted URL — loaders can fetch it directly
    }
  }
  return out;
})();
</script>`;
}

/** Runs first: storage shim (sandboxed frames have no localStorage) + error reporting. */
const RUNTIME_SHIM = `<script>
(function () {
  function memoryStorage() {
    var d = {};
    return {
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null; },
      setItem: function (k, v) { d[k] = String(v); },
      removeItem: function (k) { delete d[k]; },
      clear: function () { d = {}; },
      key: function (i) { return Object.keys(d)[i] || null; },
      get length() { return Object.keys(d).length; }
    };
  }
  ["localStorage", "sessionStorage"].forEach(function (name) {
    try { window[name].getItem("x"); }
    catch (e) { try { Object.defineProperty(window, name, { value: memoryStorage(), configurable: true }); } catch (_) {} }
  });
  function report(message) {
    try { parent.postMessage({ type: "av-preview-error", message: String(message).slice(0, 600) }, "*"); } catch (_) {}
    try {
      var box = document.getElementById("__av_err");
      if (!box) {
        box = document.createElement("pre");
        box.id = "__av_err";
        box.style.cssText = "position:fixed;left:8px;right:8px;bottom:8px;z-index:2147483647;margin:0;padding:10px 12px;border-radius:8px;background:rgba(127,29,29,.95);color:#fee2e2;font:12px/1.4 ui-monospace,Menlo,monospace;white-space:pre-wrap;max-height:35vh;overflow:auto";
        (document.body || document.documentElement).appendChild(box);
      }
      box.textContent = String(message).slice(0, 600);
    } catch (_) {}
  }
  window.addEventListener("error", function (e) { report(e.message + (e.filename ? "\\n" + e.filename.split("/").pop() + ":" + e.lineno : "")); });
  window.addEventListener("unhandledrejection", function (e) { report("Unhandled promise rejection: " + (e.reason && e.reason.message ? e.reason.message : e.reason)); });
})();
</script>`;

function classicThreeScripts(code: string): string {
  const uses = (re: RegExp) => re.test(code);
  const tags: string[] = [`${THREE_CLASSIC}/build/three.min.js`];
  if (uses(/OrbitControls/)) tags.push(`${THREE_CLASSIC}/examples/js/controls/OrbitControls.js`);
  if (uses(/GLTFLoader/)) tags.push(`${THREE_CLASSIC}/examples/js/loaders/GLTFLoader.js`);
  if (uses(/DRACOLoader/)) tags.push(`${THREE_CLASSIC}/examples/js/loaders/DRACOLoader.js`);
  if (uses(/RGBELoader/)) tags.push(`${THREE_CLASSIC}/examples/js/loaders/RGBELoader.js`);
  if (uses(/OBJLoader/)) tags.push(`${THREE_CLASSIC}/examples/js/loaders/OBJLoader.js`);
  if (uses(/MTLLoader/)) tags.push(`${THREE_CLASSIC}/examples/js/loaders/MTLLoader.js`);
  if (uses(/STLLoader/)) tags.push(`${THREE_CLASSIC}/examples/js/loaders/STLLoader.js`);
  if (uses(/FBXLoader/)) {
    tags.push(`${THREE_CLASSIC}/examples/js/libs/fflate.min.js`, `${THREE_CLASSIC}/examples/js/loaders/FBXLoader.js`);
  }
  return tags.map((src) => `<script src="${src}"></script>`).join("\n");
}

const IMPORT_MAP = `<script type="importmap">
{"imports":{"three":"${THREE_MODULE}/build/three.module.js","three/addons/":"${THREE_MODULE}/examples/jsm/","three/examples/jsm/":"${THREE_MODULE}/examples/jsm/"}}
</script>`;

function findProjectFile(files: CodeFile[], reference: string): CodeFile | undefined {
  const clean = reference.split("?")[0].split("#")[0].replace(/^\.?\/+/, "");
  if (!clean || /^(https?:)?\/\//i.test(reference)) return undefined;
  const base = clean.split("/").pop();
  return (
    files.find((f) => f.filename === clean) ||
    files.find((f) => f.filename.endsWith(`/${clean}`)) ||
    files.find((f) => f.filename.split("/").pop() === base)
  );
}

/** Inline <script src> / <link href> that point at project files, in place. */
function inlineLocalReferences(html: string, files: CodeFile[], used: Set<string>): string {
  let out = html.replace(/<script\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (whole, before, src, after) => {
    const file = findProjectFile(files, src);
    if (!file || !["js", "mjs"].includes(extOf(file))) return whole;
    used.add(file.filename);
    const attrs = `${before} ${after}`.replace(/\s(defer|async|crossorigin)(=["'][^"']*["'])?/gi, "").trim();
    return `<script${attrs ? ` ${attrs}` : ""}>\n${file.code.replace(/<\/script>/gi, "<\\/script>")}\n</script>`;
  });
  out = out.replace(/<link\b[^>]*?rel=["']stylesheet["'][^>]*?href=["']([^"']+)["'][^>]*>|<link\b[^>]*?href=["']([^"']+)["'][^>]*?rel=["']stylesheet["'][^>]*>/gi, (whole, a, b) => {
    const file = findProjectFile(files, a || b);
    if (!file) return whole;
    used.add(file.filename);
    return `<style>\n${file.code}\n</style>`;
  });
  return out;
}

/** Optionally pass `pageFilename` to pick which HTML file to render when the
 * project has more than one (a multi-page site). Defaults to index.html, or
 * the first HTML file found. */
export function buildPreviewHtml(files: CodeFile[], assets: Attachment[] = [], pageFilename?: string): string | null {
  if (files.length === 0) return null;

  const byExt = (exts: string[]) => files.filter((f) => exts.includes(extOf(f)));
  const htmlFiles = byExt(["html"]);
  const htmlFile = pageFilename
    ? htmlFiles.find((f) => f.filename === pageFilename)
    : htmlFiles.find((f) => /(^|\/)index\.html$/i.test(f.filename)) || htmlFiles[0];
  const cssFiles = byExt(["css"]);
  const jsFiles = byExt(["js", "mjs"]);
  const jsxFiles = byExt(["jsx", "tsx"]);

  const allCode = files.map((f) => f.code).join("\n");
  const usesModules = /\bfrom\s+["']three(?:\/[^"']*)?["']/.test(allCode) || /\bimport\s+["']three["']/.test(allCode);
  const usesClassicThree = !usesModules && /\bTHREE\./.test(allCode);
  const htmlAlreadyLoadsThree = !!htmlFile && /three(\.min|\.module)?\.js|type=["']importmap["']/i.test(htmlFile.code);
  const assetsBlock = assetsScript(assets);

  const threeHead = htmlAlreadyLoadsThree ? "" : usesModules ? IMPORT_MAP : usesClassicThree ? classicThreeScripts(allCode) : "";
  const head = `${RUNTIME_SHIM}\n${threeHead}\n${assetsBlock}`;

  if (htmlFile) {
    const used = new Set<string>();
    let base = inlineLocalReferences(htmlFile.code, files, used);

    // Anything the HTML never referenced still gets included, exactly as before.
    const leftoverCss = cssFiles.filter((f) => !used.has(f.filename)).map((f) => `<style>\n${f.code}\n</style>`).join("\n");
    const leftoverJs = jsFiles
      .filter((f) => !used.has(f.filename))
      .map((f) => `<script${usesModules && /^\s*import\b/m.test(f.code) ? ' type="module"' : ""}>\n${f.code.replace(/<\/script>/gi, "<\\/script>")}\n</script>`)
      .join("\n");

    const viewport = /<meta[^>]+name=["']viewport["']/i.test(base) ? "" : '<meta name="viewport" content="width=device-width, initial-scale=1" />';

    base = base.includes("</head>")
      ? base.replace("</head>", `${viewport}\n${head}\n${leftoverCss}\n</head>`)
      : `${viewport}${head}${leftoverCss}${base}`;
    base = base.includes("</body>") ? base.replace("</body>", `${leftoverJs}\n</body>`) : base + leftoverJs;
    return base;
  }

  if (jsxFiles.length > 0) {
    const componentCode = jsxFiles.map((f) => f.code).join("\n\n");
    const cssBlock = cssFiles.map((f) => `<style>\n${f.code}\n</style>`).join("\n");
    const jsBlock = jsFiles.map((f) => `<script>\n${f.code}\n</script>`).join("\n");
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${head}
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.development.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.development.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
${cssBlock}
</head>
<body>
<div id="root"></div>
<script type="text/babel" data-presets="react,typescript">
${componentCode}
const rootEl = document.getElementById('root');
const root = ReactDOM.createRoot(rootEl);
try {
  if (typeof App !== 'undefined') root.render(<App />);
  else if (typeof Component !== 'undefined') root.render(<Component />);
  else root.render(<div style={{padding:20,fontFamily:'sans-serif',color:'#888'}}>Define a component named "App" to preview it here.</div>);
} catch (e) {
  document.body.innerHTML = '<pre style="color:#b91c1c;padding:16px;white-space:pre-wrap;">' + String(e) + '</pre>';
}
</script>
${jsBlock}
</body>
</html>`;
  }

  if (cssFiles.length > 0 || jsFiles.length > 0) {
    const cssBlock = cssFiles.map((f) => `<style>\n${f.code}\n</style>`).join("\n");
    const moduleAttr = usesModules ? ' type="module"' : "";
    const jsBlock = jsFiles.map((f) => `<script${moduleAttr}>\n${f.code.replace(/<\/script>/gi, "<\\/script>")}\n</script>`).join("\n");
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
${head}
${cssBlock}
</head>
<body style="margin:0">
${jsBlock}
</body>
</html>`;
  }

  return null;
}

/** Lists every HTML file in the project, for a multi-page selector. */
export function listHtmlPages(files: CodeFile[]): string[] {
  return files.filter((f) => f.filename.toLowerCase().endsWith(".html")).map((f) => f.filename);
}