// lib/syntaxHighlight.ts
// A small, dependency-free syntax highlighter for Codespace. Rewritten as
// a single-pass tokenizer instead of chained string replacements — the
// old version ran multiple .replace() calls on the same progressively-
// mutated string, so a later pass (e.g. number highlighting) could match
// text INSIDE an HTML tag inserted by an earlier pass (e.g. string
// highlighting), corrupting the output into visible text like
// `class="text-[...]">`. This version finds all matches against the
// ORIGINAL text first, then builds the output in one linear pass, so
// matches can never nest inside each other's generated HTML.

const KEYWORDS =
  /\b(const|let|var|function|return|if|else|for|while|import|export|from|default|class|extends|new|async|await|try|catch|finally|switch|case|break|continue|typeof|instanceof|interface|type|enum|public|private|protected|static|readonly|def|elif|as|None|True|False|self|print|pass|lambda|yield)\b/g;

const STRING_RE = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const NUMBER_RE = /\b\d+(\.\d+)?\b/g;

type Token = { start: number; end: number; className: string };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function collectMatches(text: string, re: RegExp, className: string, tokens: Token[]) {
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    tokens.push({ start: m.index, end: m.index + m[0].length, className });
    if (m[0].length === 0) re.lastIndex++;
  }
}

export function highlightCode(code: string, language: string): string {
  return code
    .split("\n")
    .map((line) => highlightLine(line, language))
    .join("\n");
}

function highlightLine(line: string, language: string): string {
  // Comments cut the line short — nothing after them gets tokenized.
  const commentMatch =
    /(\/\/.*$)/.exec(line) || (language === "python" ? /(#.*$)/.exec(line) : null);
  const codePart = commentMatch ? line.slice(0, commentMatch.index) : line;
  const commentPart = commentMatch ? commentMatch[1] : "";

  const tokens: Token[] = [];
  collectMatches(codePart, STRING_RE, "text-[#9FD88B]", tokens);

  // Numbers/keywords only count if they don't fall inside a string match.
  const insideString = (pos: number) => tokens.some((t) => pos >= t.start && pos < t.end);

  const numberTokens: Token[] = [];
  collectMatches(codePart, NUMBER_RE, "text-[#D8A657]", numberTokens);
  for (const t of numberTokens) if (!insideString(t.start)) tokens.push(t);

  const keywordTokens: Token[] = [];
  collectMatches(codePart, KEYWORDS, "text-[#E38C8C]", keywordTokens);
  for (const t of keywordTokens) if (!insideString(t.start)) tokens.push(t);

  tokens.sort((a, b) => a.start - b.start);

  let out = "";
  let cursor = 0;
  for (const t of tokens) {
    if (t.start < cursor) continue; // skip overlaps
    out += escapeHtml(codePart.slice(cursor, t.start));
    out += `<span class="${t.className}">${escapeHtml(codePart.slice(t.start, t.end))}</span>`;
    cursor = t.end;
  }
  out += escapeHtml(codePart.slice(cursor));

  if (commentPart) {
    out += `<span class="text-cream/35">${escapeHtml(commentPart)}</span>`;
  }

  return out;
}