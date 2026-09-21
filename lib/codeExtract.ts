// lib/codeExtract.ts
// Pulls fenced code blocks out of the agent's replies so they show up as
// "files" in Codespace and as clickable cards in chat.
//
// The agent can name a file in any of these ways (all supported):
//   1. first line inside the block:   // filename: src/App.tsx
//                                     <!-- filename: index.html -->   # filename: main.py
//   2. a line right before the block: FILE: src/App.tsx     File: `src/App.tsx`
//                                     **src/App.tsx**       ### src/App.tsx
// Before, only (1) worked, but the Developer runtime asks for (2), so files
// ended up called "snippet-1.tsx". Auto-names are also derived from the code
// itself now, so the chat card and Codespace always agree on the same name.

import type { ChatMessage } from "@/lib/chatClient";

export type CodeFile = {
  id: string;
  filename: string;
  language: string;
  code: string;
};

export type MessagePart = { type: "text"; content: string } | { type: "file"; file: CodeFile };

type FencedBlock = { start: number; end: number; language: string; filename?: string; code: string };

const FENCE_RE = /```([\w+#.-]*)[^\n]*\n([\s\S]*?)```/g;

const EXT_BY_LANGUAGE: Record<string, string> = {
  tsx: "tsx",
  typescript: "ts",
  ts: "ts",
  javascript: "js",
  js: "js",
  jsx: "jsx",
  python: "py",
  py: "py",
  html: "html",
  css: "css",
  scss: "scss",
  json: "json",
  bash: "sh",
  sh: "sh",
  shell: "sh",
  yaml: "yml",
  yml: "yml",
  markdown: "md",
  md: "md",
  sql: "sql",
  svg: "svg",
  xml: "xml",
  vue: "vue",
  glsl: "glsl",
};

export function extFor(language: string): string {
  return EXT_BY_LANGUAGE[language.toLowerCase()] ?? "txt";
}

export function languageFromFilename(filename: string): string {
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const map: Record<string, string> = { ts: "ts", tsx: "tsx", js: "js", jsx: "jsx", mjs: "js", cjs: "js", py: "py", sh: "sh", yml: "yaml", md: "md" };
  return map[ext] || ext || "text";
}

function shortHash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  return h.toString(36).slice(0, 6);
}

const INLINE_NAME_RE = /^\s*(?:\/\/|#|\/\*|<!--|--|;)?\s*(?:filename|file|path)\s*:\s*`?([^\s`*]+?)`?\s*(?:\*\/|-->)?\s*$/i;
const LABEL_NAME_RE = /^[\s#>*_-]*(?:FILE|File|Filename|filename|Path)\s*:\s*[`*_]*([^\s`*_]+)[`*_]*\s*$/;
const BARE_NAME_RE = /^[\s#>*_`-]*([\w@./-]+\.[A-Za-z0-9]{1,8})[\s*_`:-]*$/;

function cleanPath(p: string): string {
  return p.replace(/^\.?\/+/, "").replace(/\\/g, "/");
}

/** Looks at the few lines of prose right above a fence for a file name. */
function nameFromLeadIn(lead: string): string | undefined {
  const lines = lead
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .reverse();
  for (const line of lines) {
    const labelled = line.match(LABEL_NAME_RE);
    if (labelled) return cleanPath(labelled[1]);
  }
  const last = lines[0];
  if (last && last.length < 90) {
    const bare = last.match(BARE_NAME_RE);
    if (bare && /[*`#]/.test(last)) return cleanPath(bare[1]); // only when decorated: **x.tsx**, `x.tsx`, ### x.tsx
  }
  return undefined;
}

export function parseFencedBlocks(content: string): FencedBlock[] {
  const blocks: FencedBlock[] = [];
  let previousEnd = 0;
  const re = new RegExp(FENCE_RE.source, "g");
  let match: RegExpExecArray | null;

  while ((match = re.exec(content)) !== null) {
    const language = (match[1] || "text").toLowerCase();
    let body = match[2].replace(/\s+$/, "");
    let filename: string | undefined;

    const firstLine = body.split("\n")[0] || "";
    const inline = firstLine.match(INLINE_NAME_RE);
    if (inline) {
      filename = cleanPath(inline[1]);
      body = body.split("\n").slice(1).join("\n").replace(/^\n+/, "");
    } else {
      filename = nameFromLeadIn(content.slice(previousEnd, match.index));
    }

    blocks.push({ start: match.index, end: match.index + match[0].length, language, filename, code: body });
    previousEnd = match.index + match[0].length;
  }
  return blocks;
}

function fileFromBlock(block: FencedBlock): CodeFile {
  const filename = block.filename || `snippet-${shortHash(block.code)}.${extFor(block.language)}`;
  const language = block.language === "text" || !block.language ? languageFromFilename(filename) : block.language;
  return { id: filename, filename, language, code: block.code };
}

/** Splits a chat message into text chunks and file cards (used by ChatMessage). */
export function splitMessageParts(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let cursor = 0;
  for (const block of parseFencedBlocks(content)) {
    if (block.start > cursor) parts.push({ type: "text", content: content.slice(cursor, block.start) });
    parts.push({ type: "file", file: fileFromBlock(block) });
    cursor = block.end;
  }
  if (cursor < content.length) parts.push({ type: "text", content: content.slice(cursor) });
  if (parts.length === 0) parts.push({ type: "text", content });
  return parts;
}

export function extractCodeFiles(messages: ChatMessage[]): CodeFile[] {
  // Keyed by filename so a later message that rewrites a file replaces the
  // older version instead of both showing up side by side.
  const byFilename = new Map<string, CodeFile>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of parseFencedBlocks(message.content)) {
      const file = fileFromBlock(block);
      byFilename.set(file.filename, file);
    }
  }
  return Array.from(byFilename.values());
}