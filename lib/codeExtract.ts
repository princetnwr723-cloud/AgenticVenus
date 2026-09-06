// lib/codeExtract.ts
// Pulls fenced code blocks out of the Developer Agent's replies so they
// can be shown as "files" in the Codespace panel.

import type { ChatMessage } from "@/lib/chatClient";

export type CodeFile = {
  id: string;
  filename: string;
  language: string;
  code: string;
};

const FENCE_RE = /```(\w+)?\n([\s\S]*?)```/g;

export function extractCodeFiles(messages: ChatMessage[]): CodeFile[] {
  // Keyed by filename so that when the agent updates a file in a later
  // message, the new version replaces the old one instead of both
  // showing up side by side (which is what caused old/new code to look
  // "mixed" in Codespace).
  const byFilename = new Map<string, CodeFile>();
  let autoIndex = 0;

  for (const message of messages) {
    if (message.role !== "assistant") continue;
    let match: RegExpExecArray | null;
    FENCE_RE.lastIndex = 0;
    while ((match = FENCE_RE.exec(message.content)) !== null) {
      const language = match[1] || "text";
      const body = match[2].trim();
      const firstLine = body.split("\n")[0];
      const filenameMatch = firstLine.match(/filename:\s*(\S+)/i);
      const filename = filenameMatch ? filenameMatch[1] : `snippet-${++autoIndex}.${extFor(language)}`;
      const code = filenameMatch ? body.split("\n").slice(1).join("\n") : body;

      // A later message with the same filename overwrites the earlier
      // version, so Codespace always shows the current, up-to-date file.
      byFilename.set(filename, { id: filename, filename, language, code });
    }
  }
  return Array.from(byFilename.values());
}

function extFor(language: string): string {
  const map: Record<string, string> = {
    tsx: "tsx",
    ts: "ts",
    javascript: "js",
    js: "js",
    python: "py",
    py: "py",
    html: "html",
    css: "css",
    json: "json",
    bash: "sh",
    shell: "sh",
  };
  return map[language.toLowerCase()] ?? "txt";
}