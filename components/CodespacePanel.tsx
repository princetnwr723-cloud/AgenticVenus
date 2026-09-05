"use client";

// components/CodespacePanel.tsx
// A slide-over that shows the code the Developer Agent has produced so
// far in this chat, extracted from its replies (see lib/codeExtract.ts).
// Tabs mimic a lightweight file explorer/editor so the user can see what
// the agent is "working on".

import { useState } from "react";
import type { CodeFile } from "@/lib/codeExtract";

type Props = {
  open: boolean;
  onClose: () => void;
  files: CodeFile[];
};

export default function CodespacePanel({ open, onClose, files }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  if (!open) return null;

  const active = files.find((f) => f.id === activeId) ?? files[files.length - 1];

  return (
    <div
      className="animate-fade-in fixed inset-0 z-40 flex justify-end bg-ink/30"
      onClick={onClose}
    >
      <div
        className="animate-scale-in flex h-full w-full max-w-2xl flex-col bg-[#1e1c19] text-cream shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#4D6BFE]" />
            <h2 className="text-sm font-medium">Codespace — Developer Agent</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="focus-ring rounded-md p-1 text-cream/60 hover:text-cream"
          >
            ✕
          </button>
        </div>

        {files.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-cream/40">
            The Developer Agent hasn&apos;t written any code in this chat yet.
            Ask it to build something and files will show up here.
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-48 shrink-0 overflow-y-auto border-r border-white/10 py-2">
              {files.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setActiveId(f.id)}
                  className={`block w-full truncate px-4 py-2 text-left text-xs transition-colors ${
                    (active?.id ?? files[files.length - 1].id) === f.id
                      ? "bg-white/10 text-cream"
                      : "text-cream/50 hover:bg-white/5 hover:text-cream/80"
                  }`}
                >
                  {f.filename}
                </button>
              ))}
            </div>
            <div className="flex-1 overflow-auto p-5">
              <p className="mb-3 text-xs text-cream/40">{active?.filename}</p>
              <pre className="animate-fade-in whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-cream/90">
                {active?.code}
              </pre>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
