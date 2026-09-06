"use client";

// components/CodespacePanel.tsx
// Shows the code the Developer Agent has produced, extracted and
// de-duplicated by filename (see lib/codeExtract.ts — this is what fixes
// old/new code getting mixed together when a file is updated). Includes:
// syntax highlighting, a folder-grouped file list, per-file Copy and
// Download, a "Download all" zip of the whole project, and a live
// Preview tab for HTML/CSS/JS and React projects.

import { useState } from "react";
import type { CodeFile } from "@/lib/codeExtract";
import { buildPreviewHtml } from "@/lib/preview";
import { highlightCode } from "@/lib/syntaxHighlight";

type Props = {
  open: boolean;
  onClose: () => void;
  files: CodeFile[];
};

function groupByFolder(files: CodeFile[]): Map<string, CodeFile[]> {
  const groups = new Map<string, CodeFile[]>();
  for (const f of files) {
    const parts = f.filename.split("/");
    const folder = parts.length > 1 ? parts.slice(0, -1).join("/") : "";
    if (!groups.has(folder)) groups.set(folder, []);
    groups.get(folder)!.push(f);
  }
  return groups;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CodespacePanel({ open, onClose, files }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"code" | "preview">("code");
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);

  if (!open) return null;

  const active = files.find((f) => f.id === activeId) ?? files[files.length - 1];
  const previewHtml = buildPreviewHtml(files);
  const grouped = groupByFolder(files);

  async function handleCopy() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked in some contexts — fail quietly.
    }
  }

  function handleDownloadFile() {
    if (!active) return;
    const safeName = active.filename.split("/").pop() || active.filename;
    triggerDownload(new Blob([active.code], { type: "text/plain" }), safeName);
  }

  async function handleDownloadAll() {
    if (files.length === 0) return;
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const f of files) zip.file(f.filename, f.code);
      const blob = await zip.generateAsync({ type: "blob" });
      triggerDownload(blob, "agenticvenus-project.zip");
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={onClose}>
      <div
        className="animate-scale-in flex h-full w-full max-w-3xl flex-col bg-[#1e1c19] text-cream shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#4D6BFE]" />
            <h2 className="text-sm font-medium">Codespace — Developer Agent</h2>
          </div>
          <div className="flex items-center gap-2">
            {previewHtml && files.length > 0 && (
              <div className="flex overflow-hidden rounded-md border border-white/15 text-xs">
                <button
                  onClick={() => setViewMode("code")}
                  className={`px-3 py-1.5 transition-colors ${viewMode === "code" ? "bg-white/15 text-cream" : "text-cream/50 hover:bg-white/5"}`}
                >
                  Code
                </button>
                <button
                  onClick={() => setViewMode("preview")}
                  className={`px-3 py-1.5 transition-colors ${viewMode === "preview" ? "bg-white/15 text-cream" : "text-cream/50 hover:bg-white/5"}`}
                >
                  Preview
                </button>
              </div>
            )}
            {files.length > 0 && (
              <button
                onClick={handleDownloadAll}
                disabled={zipping}
                className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-xs text-cream/70 transition-colors hover:bg-white/10 hover:text-cream disabled:opacity-50"
              >
                {zipping ? "Zipping..." : "Download all"}
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-cream/60 hover:text-cream">
              ✕
            </button>
          </div>
        </div>

        {files.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-cream/40">
            The Developer Agent hasn&apos;t written any code in this chat yet.
            Ask it to build something and files will show up here.
          </div>
        ) : viewMode === "preview" && previewHtml ? (
          <iframe
            title="Codespace preview"
            srcDoc={previewHtml}
            sandbox="allow-scripts allow-modals allow-forms"
            className="h-full w-full flex-1 border-0 bg-white"
          />
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-56 shrink-0 overflow-y-auto border-r border-white/10 py-2">
              {Array.from(grouped.entries()).map(([folder, folderFiles]) => (
                <div key={folder || "__root"}>
                  {folder && (
                    <p className="px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-cream/30">
                      {folder}
                    </p>
                  )}
                  {folderFiles.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setActiveId(f.id)}
                      className={`block w-full truncate px-4 py-2 text-left text-xs transition-colors ${
                        (active?.id ?? files[files.length - 1].id) === f.id
                          ? "bg-white/10 text-cream"
                          : "text-cream/50 hover:bg-white/5 hover:text-cream/80"
                      }`}
                    >
                      {f.filename.split("/").pop()}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex-1 overflow-auto p-5">
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs text-cream/40">{active?.filename}</p>
                <div className="flex gap-2">
                  <button
                    onClick={handleDownloadFile}
                    className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-xs text-cream/70 transition-colors hover:bg-white/10 hover:text-cream"
                  >
                    Download
                  </button>
                  <button
                    onClick={handleCopy}
                    className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-xs text-cream/70 transition-colors hover:bg-white/10 hover:text-cream"
                  >
                    {copied ? "Copied ✓" : "Copy"}
                  </button>
                </div>
              </div>
              <pre className="animate-fade-in whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed text-cream/90">
                <code
                  dangerouslySetInnerHTML={{
                    __html: active ? highlightCode(active.code, active.language) : "",
                  }}
                />
              </pre>
            </div>
          </div>
        )}

        {files.length > 0 && !previewHtml && viewMode === "code" && (
          <p className="border-t border-white/10 px-5 py-2 text-xs text-cream/35">
            No live preview available for this file type yet — preview works
            for HTML/CSS/JS and React (JSX/TSX) projects.
          </p>
        )}
      </div>
    </div>
  );
}