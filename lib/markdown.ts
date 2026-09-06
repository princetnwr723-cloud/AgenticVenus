// lib/markdown.ts
// A small, dependency-free markdown renderer for assistant replies.
// Deliberately not a full CommonMark implementation — just enough to
// make responses easy to scan: bold/important text stands out in the
// accent color, code and lists are formatted properly, and everything
// else stays as safe, escaped plain text.

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderMarkdown(raw: string): string {
  const escaped = escapeHtml(raw);
  const lines = escaped.split("\n");
  const htmlLines: string[] = [];
  let inList: "ul" | "ol" | null = null;
  let inCodeBlock = false;
  let codeBuffer: string[] = [];

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (inCodeBlock) {
        htmlLines.push(
          `<pre class="my-2 overflow-x-auto rounded-lg bg-[#1e1c19] p-3 text-[13px] text-cream/90"><code>${codeBuffer.join(
            "\n"
          )}</code></pre>`
        );
        codeBuffer = [];
        inCodeBlock = false;
      } else {
        inCodeBlock = true;
      }
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(line);
      continue;
    }

    const bulletMatch = line.match(/^\s*[-*]\s+(.*)/);
    const numberedMatch = line.match(/^\s*\d+\.\s+(.*)/);

    if (bulletMatch) {
      if (inList !== "ul") {
        closeList(htmlLines, inList);
        htmlLines.push('<ul class="my-1.5 list-disc space-y-1 pl-5">');
        inList = "ul";
      }
      htmlLines.push(`<li>${inline(bulletMatch[1])}</li>`);
      continue;
    }
    if (numberedMatch) {
      if (inList !== "ol") {
        closeList(htmlLines, inList);
        htmlLines.push('<ol class="my-1.5 list-decimal space-y-1 pl-5">');
        inList = "ol";
      }
      htmlLines.push(`<li>${inline(numberedMatch[1])}</li>`);
      continue;
    }
    closeList(htmlLines, inList);
    inList = null;

    const headingMatch = line.match(/^(#{1,3})\s+(.*)/);
    if (headingMatch) {
      const size = headingMatch[1].length === 1 ? "text-lg" : headingMatch[1].length === 2 ? "text-base" : "text-sm";
      htmlLines.push(`<p class="mt-2 mb-1 font-semibold ${size}">${inline(headingMatch[2])}</p>`);
      continue;
    }

    if (line.trim() === "") {
      htmlLines.push("<br/>");
    } else {
      htmlLines.push(`<span>${inline(line)}</span><br/>`);
    }
  }
  closeList(htmlLines, inList);

  return htmlLines.join("\n");
}

function closeList(htmlLines: string[], inList: "ul" | "ol" | null) {
  if (inList) htmlLines.push(inList === "ul" ? "</ul>" : "</ol>");
}

function inline(text: string): string {
  let out = text;
  // Bold / important — highlighted in the accent color, not just weight.
  out = out.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-clay">$1</strong>');
  out = out.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, "<em>$1</em>");
  out = out.replace(/`([^`]+?)`/g, '<code class="rounded bg-ink/8 px-1.5 py-0.5 font-mono text-[0.9em] text-ink">$1</code>');
  return out;
}