// lib/syntaxHighlight.ts
// A small, dependency-free syntax highlighter for Codespace.
//
// Single pass over the WHOLE text (so block comments and template strings that
// span lines work), one combined regex per language: matches are found against
// the ORIGINAL text and the output is built linearly, so a match can never end
// up inside HTML generated for another match.
//
// Colours are applied with inline styles (not Tailwind classes) on purpose:
// this file lives in /lib, which Tailwind doesn't scan, so class names built
// here would silently generate no CSS.

const C = {
  comment: "#6a9955",
  string: "#ce9178",
  keyword: "#569cd6",
  control: "#c586c0",
  number: "#b5cea8",
  fn: "#dcdcaa",
  type: "#4ec9b0",
  attr: "#9cdcfe",
  literal: "#569cd6",
  heading: "#569cd6",
  regex: "#d16969",
} as const;

type Rule = [color: string, source: string];

const JS_RULES: Rule[] = [
  [C.comment, String.raw`\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|(?![\s\S]))`],
  [C.string, "`(?:[^`\\\\]|\\\\[\\s\\S])*(?:`|(?![\\s\\S]))|\"(?:[^\"\\\\\\n]|\\\\.)*\"|'(?:[^'\\\\\\n]|\\\\.)*'"],
  [C.type, String.raw`<\/?[A-Za-z][\w.:-]*(?=[\s/>])`],
  [C.control, String.raw`\b(?:return|if|else|for|while|do|switch|case|break|continue|try|catch|finally|throw|await|yield|default)\b`],
  [
    C.keyword,
    String.raw`\b(?:import|export|from|const|let|var|function|class|extends|new|async|typeof|instanceof|in|of|as|interface|enum|implements|public|private|protected|static|readonly|void|delete|declare|namespace|abstract|keyof|satisfies)\b|\btype(?=\s+[A-Za-z_$])`,
  ],
  [C.literal, String.raw`\b(?:true|false|null|undefined|this|super|NaN|Infinity)\b`],
  [C.number, String.raw`\b0x[\da-fA-F]+\b|\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b`],
  [C.fn, String.raw`\b[A-Za-z_$][\w$]*(?=\s*(?:<[^>\n]*>)?\s*\()`],
  [C.type, String.raw`\b[A-Z][\w$]*\b`],
  [C.attr, String.raw`\b[a-z][\w-]*(?==["{])`],
];

const CSS_RULES: Rule[] = [
  [C.comment, String.raw`\/\*[\s\S]*?(?:\*\/|(?![\s\S]))`],
  [C.string, `"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'`],
  [C.control, String.raw`@[\w-]+`],
  [C.attr, String.raw`--[\w-]+|[a-z-]+(?=\s*:(?!:))`],
  [C.number, String.raw`#[\da-fA-F]{3,8}\b|-?\d*\.?\d+(?:px|rem|em|%|vh|vw|vmin|vmax|s|ms|deg|fr)?\b`],
  [C.fn, String.raw`\b[a-z-]+(?=\()`],
  [C.type, String.raw`[.#][A-Za-z_-][\w-]*|::?[a-z-]+`],
];

const HTML_RULES: Rule[] = [
  [C.comment, String.raw`<!--[\s\S]*?(?:-->|(?![\s\S]))`],
  [C.string, `"[^"]*"|'[^']*'`],
  [C.literal, String.raw`<!DOCTYPE[^>]*>`],
  [C.type, String.raw`<\/?[A-Za-z][\w:-]*`],
  [C.attr, String.raw`\b[\w:@.-]+(?==)`],
];

const JSON_RULES: Rule[] = [
  [C.attr, String.raw`"(?:[^"\\\n]|\\.)*"(?=\s*:)`],
  [C.string, String.raw`"(?:[^"\\\n]|\\.)*"`],
  [C.number, String.raw`-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b`],
  [C.literal, String.raw`\b(?:true|false|null)\b`],
];

const PY_RULES: Rule[] = [
  [C.comment, String.raw`#[^\n]*`],
  [C.string, `"""[\\s\\S]*?(?:"""|(?![\\s\\S]))|'''[\\s\\S]*?(?:'''|(?![\\s\\S]))|"(?:[^"\\\\\\n]|\\\\.)*"|'(?:[^'\\\\\\n]|\\\\.)*'`],
  [C.fn, String.raw`@[\w.]+`],
  [C.control, String.raw`\b(?:return|if|elif|else|for|while|break|continue|try|except|finally|raise|with|yield|await|pass|assert)\b`],
  [C.keyword, String.raw`\b(?:def|class|import|from|as|lambda|global|nonlocal|async|in|is|not|and|or|del)\b`],
  [C.literal, String.raw`\b(?:True|False|None|self|cls)\b`],
  [C.number, String.raw`\b\d+(?:\.\d+)?\b`],
  [C.fn, String.raw`\b[A-Za-z_]\w*(?=\s*\()`],
  [C.type, String.raw`\b[A-Z]\w*\b`],
];

const SHELL_RULES: Rule[] = [
  [C.comment, String.raw`#[^\n]*`],
  [C.string, `"(?:[^"\\\\]|\\\\.)*"|'[^']*'`],
  [C.attr, String.raw`\$\{?[\w@#?*]+\}?`],
  [C.control, String.raw`\b(?:if|then|else|elif|fi|for|while|do|done|case|esac|in|function|return|exit)\b`],
  [C.fn, String.raw`^\s*(?:sudo\s+)?(?:npm|npx|pnpm|yarn|node|git|cd|ls|cat|echo|mkdir|rm|cp|mv|curl|pip|python3?|docker)\b`],
  [C.number, String.raw`\b\d+\b`],
];

const MD_RULES: Rule[] = [
  [C.heading, String.raw`^#{1,6}[^\n]*`],
  [C.string, "`[^`\\n]+`"],
  [C.control, String.raw`\*\*[^*\n]+\*\*`],
  [C.attr, String.raw`\[[^\]\n]+\]\([^)\n]+\)`],
  [C.keyword, String.raw`^\s*(?:[-*+]|\d+\.)(?=\s)`],
];

const YAML_RULES: Rule[] = [
  [C.comment, String.raw`#[^\n]*`],
  [C.string, `"(?:[^"\\\\\\n]|\\\\.)*"|'[^'\\n]*'`],
  [C.attr, String.raw`^\s*-?\s*[\w.-]+(?=:)`],
  [C.literal, String.raw`\b(?:true|false|null|yes|no)\b`],
  [C.number, String.raw`\b\d+(?:\.\d+)?\b`],
];

const RULES_BY_FAMILY: Record<string, Rule[]> = {
  js: JS_RULES,
  css: CSS_RULES,
  html: HTML_RULES,
  json: JSON_RULES,
  py: PY_RULES,
  shell: SHELL_RULES,
  md: MD_RULES,
  yaml: YAML_RULES,
};

const FAMILY_BY_LANGUAGE: Record<string, string> = {
  js: "js", jsx: "js", ts: "js", tsx: "js", mjs: "js", cjs: "js", javascript: "js", typescript: "js",
  javascriptreact: "js", typescriptreact: "js", glsl: "js", java: "js", c: "js", cpp: "js", go: "js", rust: "js", rs: "js",
  css: "css", scss: "css", less: "css", sass: "css",
  html: "html", htm: "html", xml: "html", svg: "html", vue: "html",
  json: "json", jsonc: "json",
  py: "py", python: "py",
  sh: "shell", bash: "shell", shell: "shell", zsh: "shell",
  md: "md", markdown: "md", mdx: "md",
  yml: "yaml", yaml: "yaml",
};

const compiled = new Map<string, RegExp>();

function regexFor(family: string): RegExp | null {
  const cached = compiled.get(family);
  if (cached) return cached;
  const rules = RULES_BY_FAMILY[family];
  if (!rules) return null;
  const re = new RegExp(rules.map(([, src]) => `(${src})`).join("|"), "gm");
  compiled.set(family, re);
  return re;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** "src/App.tsx" or "tsx" -> language id used by the highlighter. */
export function languageFromPath(pathOrLanguage: string): string {
  const lower = pathOrLanguage.toLowerCase();
  const base = lower.split("/").pop() || lower;
  if (base === ".gitignore" || base === ".prettierignore" || base.startsWith(".env")) return "shell";
  if (base === ".prettierrc" || base === ".eslintrc") return "json";
  const ext = base.includes(".") ? base.split(".").pop()! : base;
  return ext;
}

export function highlightCode(code: string, pathOrLanguage: string): string {
  const family = FAMILY_BY_LANGUAGE[languageFromPath(pathOrLanguage)];
  const template = family ? regexFor(family) : null;
  if (!template || code.length > 250_000) return escapeHtml(code);

  const rules = RULES_BY_FAMILY[family];
  const re = new RegExp(template.source, template.flags); // own lastIndex
  let out = "";
  let cursor = 0;
  let m: RegExpExecArray | null;

  while ((m = re.exec(code)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    let group = -1;
    for (let i = 1; i < m.length; i++) {
      if (m[i] !== undefined) {
        group = i - 1;
        break;
      }
    }
    if (group < 0) continue;
    out += escapeHtml(code.slice(cursor, m.index));
    out += `<span style="color:${rules[group][0]}">${escapeHtml(m[0])}</span>`;
    cursor = m.index + m[0].length;
  }
  out += escapeHtml(code.slice(cursor));
  return out;
}