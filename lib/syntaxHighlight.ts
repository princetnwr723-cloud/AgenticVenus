// lib/syntaxHighlight.ts
// A small, dependency-free syntax highlighter for Codespace. Not a full
// tokenizer — just enough regex-based pattern matching (keywords,
// strings, comments, numbers) to make code readable at a glance without
// pulling in a heavy highlighting library.

const KEYWORDS =
  /\b(const|let|var|function|return|if|else|for|while|import|export|from|default|class|extends|new|async|await|try|catch|finally|switch|case|break|continue|typeof|instanceof|interface|type|enum|public|private|protected|static|readonly|def|elif|as|None|True|False|self|print|pass|lambda|yield)\b/g;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function highlightCode(code: string, language: string): string {
  return code
    .split("\n")
    .map((line) => highlightLine(line, language))
    .join("\n");
}

function highlightLine(line: string, language: string): string {
  let escaped = escapeHtml(line);

  const commentMatch =
    /(\/\/.*$)/.exec(escaped) || (language === "python" ? /(#.*$)/.exec(escaped) : null);
  let commentPart = "";
  if (commentMatch) {
    commentPart = `<span class="text-cream/35">${commentMatch[1]}</span>`;
    escaped = escaped.slice(0, commentMatch.index);
  }

  escaped = escaped.replace(
    /(&quot;.*?&quot;|'[^']*'|`[^`]*`)/g,
    (m) => `<span class="text-[#9FD88B]">${m}</span>`
  );

  escaped = escaped.replace(/\b(\d+(\.\d+)?)\b/g, `<span class="text-[#D8A657]">$1</span>`);

  escaped = escaped.replace(KEYWORDS, (m) => `<span class="text-[#E38C8C]">${m}</span>`);

  return escaped + commentPart;
}