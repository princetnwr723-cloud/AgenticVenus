// lib/preview.ts
// Builds a single, self-contained HTML document out of whatever code
// files the Developer Agent has written, so Codespace can show a live
// preview — HTML/CSS/JS as a real page, React/JSX via a React+Babel CDN
// shell, and Three.js/3D scenes via a Three.js CDN shell. Any binary
// assets the user attached (3D models, textures) get baked into the
// preview as `window.AGENTICVENUS_ASSETS['filename']` blob URLs, so code
// like `new THREE.GLTFLoader().load(window.AGENTICVENUS_ASSETS['x.glb'])`
// actually works with the user's real uploaded file.

import type { CodeFile } from "@/lib/codeExtract";
import type { Attachment } from "@/lib/chatClient";

function extOf(file: CodeFile): string {
  const match = file.filename.match(/\.(\w+)$/);
  return (match ? match[1] : file.language).toLowerCase();
}

function assetsScript(assets: Attachment[]): string {
  if (assets.length === 0) return "";
  const entries = assets
    .map((a) => `  "${a.name}": ${JSON.stringify(a.dataUrl)}`)
    .join(",\n");
  return `<script>
window.AGENTICVENUS_ASSETS = (function() {
  const dataUrls = {\n${entries}\n  };
  const out = {};
  for (const name in dataUrls) {
    try {
      const [meta, b64] = dataUrls[name].split(",");
      const mime = meta.match(/data:(.*?);base64/)[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      out[name] = URL.createObjectURL(new Blob([bytes], { type: mime }));
    } catch (e) { console.error("Failed to load asset", name, e); }
  }
  return out;
})();
</script>`;
}

/** Optionally pass `pageFilename` to pick which HTML file to render when
 * the project has more than one (a multi-page site). Defaults to
 * index.html, or the first HTML file found. */
export function buildPreviewHtml(
  files: CodeFile[],
  assets: Attachment[] = [],
  pageFilename?: string
): string | null {
  if (files.length === 0) return null;

  const byExt = (exts: string[]) => files.filter((f) => exts.includes(extOf(f)));
  const htmlFiles = byExt(["html"]);
  const htmlFile = pageFilename
    ? htmlFiles.find((f) => f.filename === pageFilename)
    : htmlFiles.find((f) => /index\.html$/i.test(f.filename)) || htmlFiles[0];
  const cssFiles = byExt(["css"]);
  const jsFiles = byExt(["js"]);
  const jsxFiles = byExt(["jsx", "tsx"]);

  const cssBlock = cssFiles.map((f) => `<style>\n${f.code}\n</style>`).join("\n");
  const jsBlock = jsFiles.map((f) => `<script>\n${f.code}\n</script>`).join("\n");
  const assetsBlock = assetsScript(assets);

  const allCode = files.map((f) => f.code).join("\n");
  const usesThree = /THREE\.|GLTFLoader|OrbitControls/i.test(allCode);
  const threeScripts = usesThree
    ? '<script src="https://unpkg.com/three@0.160.0/build/three.min.js"></script>\n<script src="https://unpkg.com/three@0.160.0/examples/js/loaders/GLTFLoader.js"></script>\n<script src="https://unpkg.com/three@0.160.0/examples/js/controls/OrbitControls.js"></script>'
    : "";

  if (htmlFile) {
    let base = htmlFile.code;
    base = base.includes("</head>")
      ? base.replace("</head>", `${threeScripts}\n${assetsBlock}\n${cssBlock}\n</head>`)
      : threeScripts + assetsBlock + cssBlock + base;
    base = base.includes("</body>")
      ? base.replace("</body>", `${jsBlock}\n</body>`)
      : base + jsBlock;
    return base;
  }

  if (jsxFiles.length > 0) {
    const componentCode = jsxFiles.map((f) => f.code).join("\n\n");
    return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.2.0/umd/react.development.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.2.0/umd/react-dom.development.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/babel-standalone/7.23.5/babel.min.js"></script>
<script src="https://cdn.tailwindcss.com"></script>
${threeScripts}
${assetsBlock}
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
    return `<!DOCTYPE html>
<html>
<head>
${threeScripts}
${assetsBlock}
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