"use client";

// components/CodespacePanel.tsx
// Shows the code the Developer Agent has produced, extracted and
// de-duplicated by filename (see lib/codeExtract.ts). Includes: syntax
// highlighting, a folder-grouped file list, per-file Copy and Download, a
// "Download all" zip of the whole project, a live Preview tab for
// HTML/CSS/JS and React projects, and a real Publish button (Vercel or
// Netlify) that puts the project on a live URL using the user's own
// token — this replaced the old E2B "Run in Cloud" sandbox entirely.

import { useEffect, useState } from "react";
import type { CodeFile } from "@/lib/codeExtract";
import type { Attachment } from "@/lib/chatClient";
import { buildPreviewHtml, listHtmlPages } from "@/lib/preview";
import { highlightCode } from "@/lib/syntaxHighlight";
import { publishProject } from "@/lib/publishClient";

type Props = {
  open: boolean;
  onClose: () => void;
  files: CodeFile[];
  assets?: Attachment[];
  openFileId?: string | null;
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
  a.rel = "noopener";
  // Safari (especially iOS) won't fire the download unless the anchor is
  // actually attached to the page when clicked.
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CodespacePanel({ open, onClose, files, assets = [], openFileId = null }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"code" | "preview">("code");
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewPage, setPreviewPage] = useState<string | null>(null);

  // Publish (Vercel / Netlify)
  const [publishing, setPublishing] = useState(false);
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

  // Jump straight to a specific file when opened from a chat file-card.
  useEffect(() => {
    if (open && openFileId) {
      setActiveId(openFileId);
      setViewMode("code");
    }
  }, [open, openFileId]);

  if (!open) return null;

  const active = files.find((f) => f.id === activeId) ?? files[files.length - 1];
  const htmlPages = listHtmlPages(files);
  const previewHtml = buildPreviewHtml(files, assets, previewPage || undefined);
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

  async function handlePublish(target: "vercel" | "netlify") {
    if (files.length === 0) return;
    setPublishMenuOpen(false);
    setPublishing(true);
    setPublishError(null);
    setPublishedUrl(null);
    try {
      const { url } = await publishProject(target, files);
      setPublishedUrl(url);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  async function handleDownloadFile() {
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
        className={`animate-scale-in flex h-full w-full flex-col bg-[#1e1c19] text-cream shadow-2xl transition-all ${
          fullscreen ? "max-w-full" : "max-w-3xl"
        }`}
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
              <div className="relative">
                <button
                  onClick={() => setPublishMenuOpen((o) => !o)}
                  disabled={publishing}
                  className="focus-ring rounded-md border border-moss/30 bg-moss/10 px-2.5 py-1 text-xs font-medium text-moss transition-colors hover:bg-moss/20 disabled:opacity-50"
                >
                  {publishing ? "Publishing..." : "Publish"}
                </button>
                {publishMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-white/15 bg-[#2a2723] p-1 shadow-xl"
                    onMouseLeave={() => setPublishMenuOpen(false)}
                  >
                    <button
                      onClick={() => handlePublish("vercel")}
                      className="block w-full rounded px-3 py-2 text-left text-xs text-cream/80 hover:bg-white/10"
                    >
                      Publish to Vercel
                    </button>
                    <button
                      onClick={() => handlePublish("netlify")}
                      className="block w-full rounded px-3 py-2 text-left text-xs text-cream/80 hover:bg-white/10"
                    >
                      Publish to Netlify
                    </button>
                  </div>
                )}
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
            <button
              onClick={() => setFullscreen((f) => !f)}
              aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"}
              className="focus-ring rounded-md border border-white/15 p-1.5 text-cream/60 hover:text-cream"
            >
              {fullscreen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M5.5 2H2v3.5M8.5 12H12V8.5M12 2H8.5M2 8.5V12h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
                  <path d="M2 5.5V2h3.5M12 5.5V2H8.5M2 8.5V12h3.5M12 8.5V12H8.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </button>
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
          <div className="flex h-full w-full flex-1 flex-col">
            {htmlPages.length > 1 && (
              <div className="flex items-center gap-2 border-b border-white/10 bg-[#1e1c19] px-4 py-2">
                <span className="text-xs text-cream/50">Page:</span>
                <select
                  value={previewPage || htmlPages.find((p) => /index\.html$/i.test(p)) || htmlPages[0]}
                  onChange={(e) => setPreviewPage(e.target.value)}
                  className="rounded-md border border-white/15 bg-[#2a2723] px-2 py-1 text-xs text-cream outline-none"
                >
                  {htmlPages.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-cream/30">
                  Links between pages won't navigate here (no real server) — switch pages with this dropdown instead.
                </span>
              </div>
            )}
            <iframe
              title="Codespace preview"
              srcDoc={previewHtml}
              sandbox="allow-scripts allow-modals allow-forms allow-same-origin"
              className="h-full w-full flex-1 border-0 bg-white"
            />
          </div>
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

        {publishedUrl && (
          <p className="border-t border-white/10 bg-moss/10 px-5 py-2 text-xs text-moss">
            Live at{" "}
            <a href={publishedUrl} target="_blank" rel="noreferrer" className="underline">
              {publishedUrl}
            </a>
          </p>
        )}
        {publishError && (
          <p className="border-t border-white/10 bg-red-950/40 px-5 py-2 text-xs text-red-300">{publishError}</p>
        )}
        {files.length > 0 && !previewHtml && viewMode === "code" && !publishedUrl && !publishError && (
          <p className="border-t border-white/10 px-5 py-2 text-xs text-cream/35">
            No static preview for this file type — hit{" "}
            <strong className="text-clay">Publish</strong> above to put it on a real live URL instead.
          </p>
        )}
      </div>
    </div>
  );
}