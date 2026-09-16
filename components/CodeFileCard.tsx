"use client";

// components/CodeFileCard.tsx
// A Claude-style clickable card shown inline in chat for each file the
// Developer Agent wrote, instead of a raw fenced code block. Clicking it
// opens that exact file in Codespace.

import type { CodeFile } from "@/lib/codeExtract";

const ICON: Record<string, string> = {
  html: "🌐", css: "🎨", js: "📜", jsx: "⚛️", tsx: "⚛️", ts: "📘",
  py: "🐍", json: "🗂️", md: "📝", sh: "⚙️",
};

type Props = {
  file: CodeFile;
  onOpen: (fileId: string) => void;
};

export default function CodeFileCard({ file, onOpen }: Props) {
  const lines = file.code.split("\n").length;
  return (
    <button
      onClick={() => onOpen(file.id)}
      className="focus-ring my-1.5 flex w-full max-w-xs items-center gap-3 rounded-lg border border-ink/10 bg-white px-3 py-2.5 text-left transition-all hover:-translate-y-0.5 hover:border-clay/30 hover:shadow-sm"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sand text-base">
        {ICON[file.language] || "📄"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{file.filename.split("/").pop()}</p>
        <p className="truncate text-xs text-ink/45">{lines} lines · click to open</p>
      </div>
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true" className="shrink-0 text-ink/30">
        <path d="M5 2l5 5-5 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}