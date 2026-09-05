// lib/preview.ts
// Builds a single, self-contained HTML document out of whatever code
// files the Developer Agent has written, so Codespace can show a live
// preview regardless of project type:
//  - an HTML file (+ any CSS/JS) → served as-is with styles/scripts inlined
//  - React/JSX/TSX with no HTML → wrapped in a React + Babel CDN shell
//  - CSS/JS only → shown in a minimal shell
//  - anything else (e.g. Python-only) → no live preview is possible

import type { CodeFile } from "@/lib/codeExtract";

function extOf(file: CodeFile): string {
  const match = file.filename.match(/\.(\w+)$/);
  return (match ? match[1] : file.language).toLowerCase();
}

export function buildPreviewHtml(files: CodeFile[]): string | null {
  if (files.length === 0) return null;

  const byExt = (exts: string[]) => files.filter((f) => exts.includes(extOf(f)));
  const htmlFile = files.find((f) => extOf(f) === "html");
  const cssFiles = byExt(["css"]);
  const jsFiles = byExt(["js"]);
  const jsxFiles = byExt(["jsx", "tsx"]);

  const cssBlock = cssFiles.map((f) => `<style>\n${f.code}\n</style>`).join("\n");
  const jsBlock = jsFiles.map((f) => `<script>\n${f.code}\n</script>`).join("\n");

  if (htmlFile) {
    let base = htmlFile.code;
    base = base.includes("</head>")
      ? base.replace("</head>", `${cssBlock}\n</head>`)
      : cssBlock + base;
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
<head>${cssBlock}</head>
<body>
<div style="font-family:sans-serif;padding:20px;color:#888">Preview of styles/script — add an HTML file for a full page preview.</div>
${jsBlock}
</body>
</html>`;
  }

  return null;
}