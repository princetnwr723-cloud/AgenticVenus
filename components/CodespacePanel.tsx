"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { CodeFile } from "@/lib/codeExtract";
import type { Attachment } from "@/lib/chatClient";
import { buildPreviewHtml, listHtmlPages } from "@/lib/preview";
import { highlightCode } from "@/lib/syntaxHighlight";
import { publishProject } from "@/lib/publishClient";
import VerificationBadge from "@/components/VerificationBadge";
import { writeAgentFile, ensureAgentWorkspace, listAgentFiles, runAgentSessionCommand, getAgentPreview } from "@/lib/workspaceClient";

type Props = {
  open: boolean;
  onClose: () => void;
  files: CodeFile[];
  assets?: Attachment[];
  openFileId?: string | null;
  livePreviewUrl?: string | null;
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
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function CodespacePanel({ open, onClose, files, assets = [], openFileId = null, livePreviewUrl = null }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<"code" | "preview">("code");
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [previewPage, setPreviewPage] = useState<string | null>(null);
  const [editedCode, setEditedCode] = useState("");
  const [savingCode, setSavingCode] = useState(false);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishVerified, setPublishVerified] = useState<boolean | null>(null);
  const [publishReason, setPublishReason] = useState<string>("");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [terminalCommand, setTerminalCommand] = useState("");
  const [terminalBusy, setTerminalBusy] = useState(false);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(true);
  const [livePort, setLivePort] = useState("3000");
  const [livePreviewMessage, setLivePreviewMessage] = useState<string | null>(null);
  const [workspaceFiles, setWorkspaceFiles] = useState<CodeFile[]>([]);
  const [workspaceSyncing, setWorkspaceSyncing] = useState(false);

  useEffect(() => {
    if (livePreviewUrl) setViewMode("preview");
  }, [livePreviewUrl]);

  useEffect(() => {
    if (open && openFileId) {
      setActiveId(openFileId);
      setViewMode("code");
    }
  }, [open, openFileId]);

  async function syncWorkspace() {
    if (!open) return;
    try {
      setWorkspaceSyncing(true);
      await ensureAgentWorkspace();
      const remote = await listAgentFiles(true);
      const mapped: CodeFile[] = remote.map((f) => ({ id: `workspace:${f.path}`, filename: f.path, code: f.content || "" }));
      setWorkspaceFiles(mapped);
      setWorkspaceReady(true);
      if (!activeId && mapped.length) setActiveId(mapped[mapped.length - 1].id);
    } catch (e) {
      setTerminalLines((x) => [...x, `✕ Workspace sync: ${e instanceof Error ? e.message : String(e)}`]);
    } finally {
      setWorkspaceSyncing(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    syncWorkspace();
    const timer = window.setInterval(() => syncWorkspace(), 2000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const displayFiles = workspaceFiles.length > 0 ? workspaceFiles : files;

  useEffect(() => {
    const current = displayFiles.find((f) => f.id === activeId) ?? displayFiles[displayFiles.length - 1];
    setEditedCode(current?.code || "");
    setSaveMessage(null);
  }, [activeId, workspaceFiles, files]);

  if (!open) return null;

  const active = displayFiles.find((f) => f.id === activeId) ?? displayFiles[displayFiles.length - 1];
  const htmlPages = listHtmlPages(displayFiles);
  const previewHtml = buildPreviewHtml(displayFiles, assets, previewPage || undefined);
  const grouped = groupByFolder(displayFiles);

  async function handleCopy() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {}
  }

  async function handlePublish(target: "vercel" | "netlify") {
    if (displayFiles.length === 0) return;
    setPublishMenuOpen(false);
    setPublishing(true);
    setPublishError(null);
    setPublishedUrl(null);
    setPublishVerified(null);
    try {
      const { url, verified, verificationReason } = await publishProject(target, displayFiles);
      setPublishedUrl(url);
      setPublishVerified(verified);
      setPublishReason(verificationReason);
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

  async function handleSaveToCloud() {
    if (!active || savingCode) return;
    setSavingCode(true);
    setSaveMessage(null);
    try {
      await writeAgentFile(active.filename, editedCode);
      setSaveMessage("Saved to cloud workspace ✓");
    } catch (err) {
      setSaveMessage(err instanceof Error ? err.message : "Cloud save failed.");
    } finally {
      setSavingCode(false);
    }
  }

  async function runTerminal(e?: FormEvent) {
    e?.preventDefault();
    const cmd = terminalCommand.trim();
    if (!cmd || terminalBusy) return;
    setTerminalCommand("");
    setTerminalBusy(true);
    setTerminalLines((x) => [...x, `$ ${cmd}`]);
    try {
      const result = await runAgentSessionCommand(cmd, "agenticvenus-terminal", false);
      const output = result.output || result.stdout || result.stderr || "";
      setTerminalLines((x) => [...x, output || `(exit ${result.exitCode ?? 0})`, `exit ${result.exitCode ?? 0}`]);
    } catch (e2) {
      setTerminalLines((x) => [...x, `✕ ${e2 instanceof Error ? e2.message : String(e2)}`]);
    } finally {
      setTerminalBusy(false);
    }
  }

  async function openLivePreview() {
    try {
      const result = await getAgentPreview(Number(livePort) || 3000);
      setLivePreviewMessage(result.url);
      setViewMode("preview");
    } catch (e) {
      setTerminalLines((x) => [...x, `✕ Preview: ${e instanceof Error ? e.message : String(e)}`]);
    }
  }

  async function handleDownloadAll() {
    if (displayFiles.length === 0) return;
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const f of displayFiles) zip.file(f.filename, f.code);
      const blob = await zip.generateAsync({ type: "blob" });
      triggerDownload(blob, "agenticvenus-project.zip");
    } finally {
      setZipping(false);
    }
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={onClose}>
      <div
        className={`animate-scale-in flex h-full w-full flex-col bg-[#1e1c19] text-cream shadow-2xl transition-all ${fullscreen ? "max-w-full" : "max-w-3xl"}`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#4D6BFE]" />
            <h2 className="text-sm font-medium">Codespace — Developer Agent</h2>
          </div>
          <div className="flex items-center gap-2">
            {(previewHtml && displayFiles.length > 0 || livePreviewUrl) && (
              <div className="flex overflow-hidden rounded-md border border-white/15 text-xs">
                <button onClick={() => setViewMode("code")} className={`px-3 py-1.5 transition-colors ${viewMode === "code" ? "bg-white/15 text-cream" : "text-cream/50 hover:bg-white/5"}`}>Code</button>
                <button onClick={() => setViewMode("preview")} className={`px-3 py-1.5 transition-colors ${viewMode === "preview" ? "bg-white/15 text-cream" : "text-cream/50 hover:bg-white/5"}`}>Preview</button>
              </div>
            )}
            {displayFiles.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setPublishMenuOpen((o) => !o)}
                  disabled={publishing}
                  className="focus-ring rounded-md border border-moss/30 bg-moss/10 px-2.5 py-1 text-xs font-medium text-moss transition-colors hover:bg-moss/20 disabled:opacity-50"
                >
                  {publishing ? "Publishing..." : "Publish"}
                </button>
                {publishMenuOpen && (
                  <div className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-white/15 bg-[#2a2723] p-1 shadow-xl" onMouseLeave={() => setPublishMenuOpen(false)}>
                    <button onClick={() => handlePublish("vercel")} className="block w-full rounded px-3 py-2 text-left text-xs text-cream/80 hover:bg-white/10">Publish to Vercel</button>
                    <button onClick={() => handlePublish("netlify")} className="block w-full rounded px-3 py-2 text-left text-xs text-cream/80 hover:bg-white/10">Publish to Netlify</button>
                  </div>
                )}
              </div>
            )}
            {displayFiles.length > 0 && (
              <button onClick={handleDownloadAll} disabled={zipping} className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-xs text-cream/70 transition-colors hover:bg-white/10 hover:text-cream disabled:opacity-50">
                {zipping ? "Zipping..." : "Download all"}
              </button>
            )}
            <button onClick={() => setFullscreen((f) => !f)} aria-label={fullscreen ? "Exit fullscreen" : "Fullscreen"} className="focus-ring rounded-md border border-white/15 p-1.5 text-cream/60 hover:text-cream">
              {fullscreen ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M5.5 2H2v3.5M8.5 12H12V8.5M12 2H8.5M2 8.5V12h3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true"><path d="M2 5.5V2h3.5M12 5.5V2H8.5M2 8.5V12h3.5M12 8.5V12H8.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              )}
            </button>
            <button onClick={onClose} aria-label="Close" className="focus-ring rounded-md p-1 text-cream/60 hover:text-cream">✕</button>
          </div>
        </div>

        {displayFiles.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-cream/40">
            The Developer Agent hasn&apos;t written any code in this chat yet. Ask it to build something and files will show up here.
          </div>
        ) : viewMode === "preview" && (livePreviewUrl || livePreviewMessage || previewHtml) ? (
          <div className="flex h-full w-full flex-1 flex-col">
            {htmlPages.length > 1 && (
              <div className="flex items-center gap-2 border-b border-white/10 bg-[#1e1c19] px-4 py-2">
                <span className="text-xs text-cream/50">Page:</span>
                <select value={previewPage || htmlPages.find((p) => /index\.html$/i.test(p)) || htmlPages[0]} onChange={(e) => setPreviewPage(e.target.value)} className="rounded-md border border-white/15 bg-[#2a2723] px-2 py-1 text-xs text-cream outline-none">
                  {htmlPages.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
                <span className="text-xs text-cream/30">Links between pages won't navigate here — switch pages with this dropdown instead.</span>
              </div>
            )}
            {(livePreviewUrl || livePreviewMessage) ? (
              <iframe title="Codespace live preview" src={livePreviewUrl || livePreviewMessage || undefined} sandbox="allow-scripts allow-forms allow-same-origin" className="h-full w-full flex-1 border-0 bg-white" />
            ) : previewHtml ? (
              <iframe title="Codespace static preview" srcDoc={previewHtml || undefined} sandbox="allow-scripts allow-modals allow-forms allow-same-origin" className="h-full w-full flex-1 border-0 bg-white" />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-cream/40">{livePreviewMessage || "Preview is not ready yet."}</div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            <div className="w-56 shrink-0 overflow-y-auto border-r border-white/10 py-2">
              {Array.from(grouped.entries()).map(([folder, folderFiles]) => (
                <div key={folder || "__root"}>
                  {folder && <p className="px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-cream/30">{folder}</p>}
                  {folderFiles.map((f) => (
                    <button key={f.id} onClick={() => setActiveId(f.id)} className={`block w-full truncate px-4 py-2 text-left text-xs transition-colors ${(active?.id ?? displayFiles[displayFiles.length - 1]?.id) === f.id ? "bg-white/10 text-cream" : "text-cream/50 hover:bg-white/5 hover:text-cream/80"}`}>
                      {f.filename.split("/").pop()}
                    </button>
                  ))}
                </div>
              ))}
            </div>
            <div className="flex-1 overflow-auto p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-xs text-cream/40">{active?.filename}</p>
                <div className="flex shrink-0 gap-2">
                  <button onClick={handleSaveToCloud} disabled={savingCode} className="focus-ring rounded-md border border-moss/30 bg-moss/10 px-2.5 py-1 text-xs text-moss transition-colors hover:bg-moss/20 disabled:opacity-50">{savingCode ? "Saving..." : "Save to Cloud"}</button>
                  <button onClick={handleDownloadFile} className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-xs text-cream/70 transition-colors hover:bg-white/10 hover:text-cream">Download</button>
                  <button onClick={handleCopy} className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-xs text-cream/70 transition-colors hover:bg-white/10 hover:text-cream">{copied ? "Copied ✓" : "Copy"}</button>
                </div>
              </div>
              <textarea
                value={editedCode}
                onChange={(e) => { setEditedCode(e.target.value); setSaveMessage(null); }}
                spellCheck={false}
                className="h-full min-h-[420px] w-full resize-none rounded-md border border-white/10 bg-[#141311] p-4 font-mono text-[13px] leading-relaxed text-cream/90 outline-none focus:border-white/20"
                aria-label={active?.filename || "Code editor"}
              />
              {saveMessage && <p className="mt-2 text-[11px] text-cream/40">{saveMessage}</p>}
            </div>
          </div>
        )}

        <div className={`${terminalOpen ? "h-56" : "h-10"} shrink-0 border-t border-white/10 bg-[#0d0d0c]`}>
          <div className="flex h-10 items-center gap-2 border-b border-white/10 px-4">
            <button onClick={() => setTerminalOpen((v) => !v)} className="text-xs font-medium text-cream/70">⌄ Terminal</button>
            <span className={`h-1.5 w-1.5 rounded-full ${workspaceReady ? "bg-moss" : "bg-clay"}`} />
            <span className="text-[10px] text-cream/30">{workspaceReady ? `Persistent workspace${workspaceSyncing ? " · syncing" : ""}` : "Connecting…"}</span>
            <div className="ml-auto flex items-center gap-1">
              <input value={livePort} onChange={(e) => setLivePort(e.target.value)} className="w-14 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[10px] text-cream outline-none" />
              <button onClick={openLivePreview} className="rounded border border-white/10 px-2 py-1 text-[10px] text-cream/60 hover:bg-white/10 hover:text-cream">Open preview</button>
            </div>
          </div>
          {terminalOpen && <div className="flex h-[calc(100%-2.5rem)] flex-col">
            <div className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-cream/70">
              {terminalLines.length ? terminalLines.map((line, i) => <div key={i} className="whitespace-pre-wrap break-words">{line}</div>) : <div className="text-cream/25">Terminal ready. Try npm install, npm run build, npm run dev, git status…</div>}
            </div>
            <form onSubmit={runTerminal} className="flex border-t border-white/10 px-3 py-2">
              <span className="mr-2 font-mono text-xs text-moss">$</span>
              <input value={terminalCommand} onChange={(e) => setTerminalCommand(e.target.value)} placeholder="Run a command…" className="min-w-0 flex-1 bg-transparent font-mono text-xs text-cream outline-none placeholder:text-cream/25" />
              <button disabled={terminalBusy} className="ml-2 rounded bg-white/10 px-3 py-1 text-[11px] text-cream disabled:opacity-40">{terminalBusy ? "Running" : "Run"}</button>
            </form>
          </div>}
        </div>

        {publishedUrl && (
          <div className="flex items-center gap-2 border-t border-white/10 bg-moss/10 px-5 py-2 text-xs text-moss">
            <a href={publishedUrl} target="_blank" rel="noreferrer" className="underline">{publishedUrl}</a>
            {publishVerified !== null && <VerificationBadge verified={publishVerified} reason={publishReason} />}
          </div>
        )}
        {publishError && <p className="border-t border-white/10 bg-red-950/40 px-5 py-2 text-xs text-red-300">{publishError}</p>}
        {displayFiles.length > 0 && !previewHtml && viewMode === "code" && !publishedUrl && !publishError && (
          <p className="border-t border-white/10 px-5 py-2 text-xs text-cream/35">
            No static preview for this file type — hit <strong className="text-clay">Publish</strong> above to put it on a real live URL instead.
          </p>
        )}
      </div>
    </div>
  );
}