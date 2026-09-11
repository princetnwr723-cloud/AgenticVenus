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
import type { Attachment } from "@/lib/chatClient";
import { buildPreviewHtml, listHtmlPages } from "@/lib/preview";
import { highlightCode } from "@/lib/syntaxHighlight";
import { startCloudPreview, waitForCloudPreview, stopCloudPreview } from "@/lib/sandboxClient";

type Props = {
  open: boolean;
  onClose: () => void;
  files: CodeFile[];
  assets?: Attachment[];
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

export default function CodespacePanel({ open, onClose, files, assets = [] }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"code" | "preview">("code");
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewPage, setPreviewPage] = useState<string | null>(null);
  const [cloudUrl, setCloudUrl] = useState<string | null>(null);
  const [cloudSandboxId, setCloudSandboxId] = useState<string | null>(null);
  const [cloudLoading, setCloudLoading] = useState(false);
  const [cloudError, setCloudError] = useState<string | null>(null);
  const [cloudLog, setCloudLog] = useState<string>("");

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

  async function handleRunInCloud() {
    if (files.length === 0) return;
    setCloudLoading(true);
    setCloudError(null);
    setCloudLog("");
    setCloudUrl(null);
    if (cloudSandboxId) await stopCloudPreview(cloudSandboxId);
    try {
      const { sandboxId } = await startCloudPreview(files);
      setCloudSandboxId(sandboxId);
      setViewMode("preview");
      const previewUrl = await waitForCloudPreview(sandboxId, (log) => setCloudLog(log));
      setCloudUrl(previewUrl);
    } catch (err) {
      setCloudError(err instanceof Error ? err.message : "Failed to start the cloud sandbox.");
    } finally {
      setCloudLoading(false);
    }
  }

  function handleCloseCloud() {
    if (cloudSandboxId) stopCloudPreview(cloudSandboxId);
    setCloudSandboxId(null);
    setCloudUrl(null);
    setCloudLog("");
    setCloudError(null);
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
            {(previewHtml || cloudUrl) && files.length > 0 && (
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
                onClick={handleRunInCloud}
                disabled={cloudLoading}
                className="focus-ring rounded-md border border-clay/30 bg-clay/10 px-2.5 py-1 text-xs font-medium text-clay transition-colors hover:bg-clay/20 disabled:opacity-50"
              >
                {cloudLoading ? "Starting sandbox..." : cloudUrl ? "Restart in Cloud" : "Run in Cloud"}
              </button>
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
        ) : viewMode === "preview" && cloudLoading && !cloudUrl ? (
          <div className="flex h-full w-full flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
            <span className="h-2 w-2 animate-pulse rounded-full bg-clay" />
            <p className="text-sm text-cream/70">Starting your cloud sandbox — installing dependencies and starting the server...</p>
            {cloudLog && (
              <pre className="mt-2 max-h-40 w-full max-w-lg overflow-auto rounded-md bg-black/40 p-3 text-left text-[11px] text-cream/50">
                {cloudLog}
              </pre>
            )}
          </div>
        ) : viewMode === "preview" && (cloudUrl || previewHtml) ? (
          <div className="flex h-full w-full flex-1 flex-col">
            {cloudUrl ? (
              <div className="flex items-center gap-2 border-b border-white/10 bg-[#1e1c19] px-4 py-2">
                <span className="h-1.5 w-1.5 rounded-full bg-moss" />
                <span className="text-xs text-cream/60">Live cloud sandbox — real server, any language</span>
                <a href={cloudUrl} target="_blank" rel="noreferrer" className="text-xs text-clay hover:underline">
                  Open in new tab
                </a>
                <button onClick={handleCloseCloud} className="ml-auto text-xs text-cream/40 hover:text-cream">
                  Stop sandbox
                </button>
              </div>
            ) : (
              htmlPages.length > 1 && (
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
              )
            )}
            <iframe
              title="Codespace preview"
              {...(cloudUrl ? { src: cloudUrl } : { srcDoc: previewHtml! })}
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

        {cloudError && (
          <p className="border-t border-white/10 bg-red-950/40 px-5 py-2 text-xs text-red-300">{cloudError}</p>
        )}
        {files.length > 0 && !previewHtml && !cloudUrl && viewMode === "code" && (
          <p className="border-t border-white/10 px-5 py-2 text-xs text-cream/35">
            No static preview for this file type — click <strong className="text-clay">Run in Cloud</strong> above to run it for real in a live sandbox instead (works for any language).
          </p>
        )}
      </div>
    </div>
  );
}