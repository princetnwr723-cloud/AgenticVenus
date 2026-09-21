"use client";

// components/CodespacePanel.tsx
// Codespace, rebuilt to the reference design: a "Code" view switcher, a
// Publish button (with a dot when there is something new to publish), a
// collapsible file tree on the left, a breadcrumb + copy/download bar, and a
// line-numbered, syntax-highlighted editor.
//
// What changed under the hood
//  - Shows EVERY file the agent creates: the cloud workspace (Daytona) files
//    and the files from the chat are merged (workspace wins per path). New
//    files appear instantly (refresh event on each write) and, while the agent
//    is working, the panel follows the file being written.
//  - No more polling storms or repeating errors: the workspace is polled
//    gently, and if no Daytona key exists it stops and says so once.
//  - Preview tab: localhost:<port> from the cloud workspace (auto-opened when
//    the terminal or the agent starts a dev server) or a static preview built
//    from the files. The static preview runs sandboxed (no access to the app's
//    login), supports Three.js, and reports runtime errors.
//  - Terminal drawer runs inside the project folder.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CodeFile } from "@/lib/codeExtract";
import { languageFromFilename } from "@/lib/codeExtract";
import type { Attachment } from "@/lib/chatClient";
import { buildPreviewHtml, listHtmlPages } from "@/lib/preview";
import { publishProject } from "@/lib/publishClient";
import { getAgentPreview, listAgentFiles, WORKSPACE_CHANGED_EVENT, writeAgentFile } from "@/lib/workspaceClient";
import VerificationBadge from "@/components/VerificationBadge";
import FileTree from "@/components/codespace/FileTree";
import CodeEditor from "@/components/codespace/CodeEditor";
import TerminalPane from "@/components/codespace/TerminalPane";

type Props = {
  open: boolean;
  onClose: () => void;
  files: CodeFile[];
  assets?: Attachment[];
  openFileId?: string | null;
  livePreviewUrl?: string | null;
  /** true while the agent is building — makes the panel refresh faster and follow new files */
  agentBusy?: boolean;
};

type MenuName = "view" | "more" | "publish" | null;
type RemoteFile = { path: string; content: string };

const normPath = (p: string) => p.replace(/\\/g, "/").replace(/^\.?\/+/, "").replace(/^workspace\//, "");

function pickDefault(paths: string[]): string {
  const order = [/(^|\/)index\.html$/i, /(^|\/)src\/App\.tsx$/, /(^|\/)app\/page\.tsx$/, /(^|\/)main\.(js|ts|tsx)$/, /(^|\/)README\.md$/i];
  for (const re of order) {
    const hit = paths.find((p) => re.test(p));
    if (hit) return hit;
  }
  return paths[0];
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

// ---- tiny icons ----
const Icon = {
  code: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="m6.2 5.2-3.6 3.8 3.6 3.8M11.8 5.2l3.6 3.8-3.6 3.8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  eye: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M1.8 9S4.4 4 9 4s7.2 5 7.2 5-2.6 5-7.2 5-7.2-5-7.2-5Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <circle cx="9" cy="9" r="2.1" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  terminal: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="14" height="12" rx="2.4" stroke="currentColor" strokeWidth="1.5" />
      <path d="m5.6 7.2 2.4 1.9-2.4 1.9M9.6 11.2h2.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  down: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="m3.5 5.4 3.5 3.5 3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  dots: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="currentColor" aria-hidden="true">
      <circle cx="3.5" cy="9" r="1.4" />
      <circle cx="9" cy="9" r="1.4" />
      <circle cx="14.5" cy="9" r="1.4" />
    </svg>
  ),
  upload: (
    <svg width="17" height="17" viewBox="0 0 17 17" fill="none" aria-hidden="true">
      <path d="M8.5 11V2.6M5.2 5.6l3.3-3.2 3.3 3.2M2.8 10.4v2.2a1.6 1.6 0 0 0 1.6 1.6h8.2a1.6 1.6 0 0 0 1.6-1.6v-2.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  close: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="m3.5 3.5 9 9M12.5 3.5l-9 9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  ),
  copy: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <rect x="6" y="6" width="9" height="9" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 6V4.6A1.6 1.6 0 0 0 10.4 3H4.6A1.6 1.6 0 0 0 3 4.6v5.8A1.6 1.6 0 0 0 4.6 12H6" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  ),
  download: (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 3v8.4M5.6 8.2 9 11.6l3.4-3.4M3 14.6h12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  pencil: (
    <svg width="17" height="17" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="m11.2 3.6 3.2 3.2M3.4 14.6l.6-3 7.8-7.8a1.4 1.4 0 0 1 2 0l1.2 1.2a1.4 1.4 0 0 1 0 2L7.4 14l-4 .6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  ),
  refresh: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M13.4 8A5.4 5.4 0 1 1 11.8 4.2M13.4 2.4v3h-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  external: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9 2.8h4.2V7M13 3 7.6 8.4M11.4 9.6v2.6a1.2 1.2 0 0 1-1.2 1.2H3.8a1.2 1.2 0 0 1-1.2-1.2V5.8a1.2 1.2 0 0 1 1.2-1.2h2.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  check: (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <path d="m3 7.4 2.6 2.6L11 4.4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};

function IconButton({ label, onClick, disabled, active, children }: { label: string; onClick?: () => void; disabled?: boolean; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`flex h-9 w-9 items-center justify-center rounded-lg border transition-colors disabled:opacity-40 ${
        active ? "border-[#4a4a4a] bg-[#2f2f2f] text-white" : "border-transparent text-[#c4c4c4] hover:bg-[#262626] hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function MenuItem({ icon, label, hint, checked, disabled, onClick }: { icon?: React.ReactNode; label: string; hint?: string; checked?: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[13.5px] text-[#e4e4e4] transition-colors hover:bg-[#2c2c2c] disabled:opacity-40"
    >
      <span className="flex w-5 shrink-0 justify-center text-[#a5a5a5]">{icon}</span>
      <span className="flex-1">
        {label}
        {hint && <span className="block text-[11.5px] text-[#7d7d7d]">{hint}</span>}
      </span>
      {checked && <span className="text-[#0a84ff]">{Icon.check}</span>}
    </button>
  );
}

export default function CodespacePanel({ open, onClose, files, assets = [], openFileId = null, livePreviewUrl = null, agentBusy = false }: Props) {
  const [view, setView] = useState<"code" | "preview">("code");
  const [menu, setMenu] = useState<MenuName>(null);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const [activePath, setActivePath] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const [remote, setRemote] = useState<RemoteFile[]>([]);
  const [cloud, setCloud] = useState<"connecting" | "ready" | "off" | "error">("connecting");
  const [syncing, setSyncing] = useState(false);

  const [publishing, setPublishing] = useState(false);
  const [publishedUrl, setPublishedUrl] = useState<string | null>(null);
  const [publishVerified, setPublishVerified] = useState<boolean | null>(null);
  const [publishReason, setPublishReason] = useState("");
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishedSig, setPublishedSig] = useState<string | null>(null);

  const [previewPort, setPreviewPort] = useState("3000");
  const [remoteUrl, setRemoteUrl] = useState<string | null>(null);
  const [previewSource, setPreviewSource] = useState<"live" | "static">("static");
  const [previewPage, setPreviewPage] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);

  const inFlight = useRef(false);
  const cloudOff = useRef(false);
  const lastPick = useRef(0);
  const knownPaths = useRef<Set<string>>(new Set());
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // ---------------------------------------------------------------- files
  const merged = useMemo<CodeFile[]>(() => {
    const map = new Map<string, CodeFile>();
    for (const f of files) {
      const path = normPath(f.filename);
      map.set(path, { id: path, filename: path, language: f.language, code: f.code });
    }
    for (const r of remote) {
      map.set(r.path, { id: r.path, filename: r.path, language: languageFromFilename(r.path), code: r.content });
    }
    for (const [path, code] of Object.entries(drafts)) {
      const current = map.get(path);
      if (current) map.set(path, { ...current, code });
    }
    return Array.from(map.values()).sort((a, b) => a.filename.localeCompare(b.filename));
  }, [files, remote, drafts]);

  const active = merged.find((f) => f.filename === activePath) ?? null;
  const signature = useMemo(() => merged.map((f) => `${f.filename}:${f.code.length}`).join("|"), [merged]);
  const needsPublish = merged.length > 0 && (!publishedUrl || publishedSig !== signature);
  const dirtyPaths = Object.keys(drafts);

  const sync = useCallback(async () => {
    if (inFlight.current || cloudOff.current) return;
    inFlight.current = true;
    setSyncing(true);
    try {
      const list = await listAgentFiles(true);
      const next = list.map((f) => ({ path: normPath(f.path), content: f.content ?? "" }));
      setRemote((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
      setCloud("ready");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("NO_DAYTONA")) {
        cloudOff.current = true;
        setCloud("off");
      } else {
        setCloud("error");
      }
    } finally {
      inFlight.current = false;
      setSyncing(false);
    }
  }, []);

  // Poll gently; refresh right away whenever any code writes a file.
  useEffect(() => {
    if (!open) return;
    cloudOff.current = false;
    sync();
    const interval = window.setInterval(sync, agentBusy ? 2500 : 7000);
    let debounce: number | undefined;
    const onChanged = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(sync, 350);
    };
    window.addEventListener(WORKSPACE_CHANGED_EVENT, onChanged);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(debounce);
      window.removeEventListener(WORKSPACE_CHANGED_EVENT, onChanged);
    };
  }, [open, agentBusy, sync]);

  // Choose / follow the open file.
  useEffect(() => {
    if (!merged.length) {
      setActivePath(null);
      return;
    }
    const paths = merged.map((f) => f.filename);
    const firstLoad = knownPaths.current.size === 0;
    const fresh = paths.filter((p) => !knownPaths.current.has(p));
    paths.forEach((p) => knownPaths.current.add(p));
    setActivePath((current) => {
      if (!current || !paths.includes(current)) return pickDefault(paths);
      if (!firstLoad && agentBusy && fresh.length && Date.now() - lastPick.current > 8000) return fresh[fresh.length - 1];
      return current;
    });
  }, [merged, agentBusy]);

  useEffect(() => {
    if (open && openFileId) {
      setActivePath(normPath(openFileId));
      lastPick.current = Date.now();
      setView("code");
      setEditing(false);
    }
  }, [open, openFileId]);

  useEffect(() => {
    if (livePreviewUrl) {
      setRemoteUrl(livePreviewUrl);
      setPreviewSource("live");
      setView("preview");
    }
  }, [livePreviewUrl]);

  useEffect(() => {
    if (!note) return;
    const t = window.setTimeout(() => setNote(null), 2600);
    return () => window.clearTimeout(t);
  }, [note]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (menu) setMenu(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, menu, onClose]);

  // ---------------------------------------------------------------- preview
  const htmlPages = useMemo(() => listHtmlPages(merged), [merged]);
  const staticHtml = useMemo(
    () => (view === "preview" ? buildPreviewHtml(merged, assets, previewPage || undefined) : null),
    [view, merged, assets, previewPage]
  );

  useEffect(() => {
    function onMessage(e: MessageEvent) {
      if (e.data?.type === "av-preview-error" && e.source === iframeRef.current?.contentWindow) {
        setPreviewError(String(e.data.message || "Runtime error"));
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    setPreviewError(null);
  }, [staticHtml, previewKey, previewSource, remoteUrl]);

  const openLive = useCallback(async (port: number) => {
    try {
      const result = await getAgentPreview(port);
      setPreviewPort(String(port));
      setRemoteUrl(result.url);
      setPreviewSource("live");
      setPreviewKey((k) => k + 1);
      setView("preview");
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't open the preview.");
    }
  }, []);

  // ---------------------------------------------------------------- actions
  function selectFile(path: string) {
    setActivePath(path);
    lastPick.current = Date.now();
    setEditing(false);
  }

  function changeActive(value: string) {
    if (!activePath) return;
    setDrafts((d) => ({ ...d, [activePath]: value }));
  }

  async function saveActive() {
    if (!active || saving || drafts[active.filename] === undefined) return;
    const path = active.filename;
    const content = drafts[path];
    setSaving(true);
    try {
      await writeAgentFile(path, content);
      setDrafts((d) => {
        const { [path]: _removed, ...rest } = d;
        return rest;
      });
      setRemote((prev) => [...prev.filter((r) => r.path !== path), { path, content }]);
      setNote("Saved to the cloud workspace");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Couldn't save.";
      setNote(message.startsWith("NO_DAYTONA") ? "Edit kept in this tab — add a Daytona key in Settings → Integrations to save it to the cloud workspace." : message);
    } finally {
      setSaving(false);
    }
  }

  async function copyActive() {
    if (!active) return;
    try {
      await navigator.clipboard.writeText(active.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setNote("Copy isn't allowed in this browser.");
    }
  }

  function downloadActive() {
    if (!active) return;
    triggerDownload(new Blob([active.code], { type: "text/plain" }), active.filename.split("/").pop() || active.filename);
  }

  async function downloadAll() {
    if (!merged.length) return;
    setMenu(null);
    setZipping(true);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      for (const f of merged) zip.file(f.filename, f.code);
      triggerDownload(await zip.generateAsync({ type: "blob" }), "agenticvenus-project.zip");
    } finally {
      setZipping(false);
    }
  }

  async function publish(target: "vercel" | "netlify") {
    if (!merged.length) return;
    setMenu(null);
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await publishProject(target, merged);
      setPublishedUrl(result.url);
      setPublishVerified(result.verified);
      setPublishReason(result.verificationReason);
      setPublishedSig(signature);
    } catch (err) {
      setPublishError(err instanceof Error ? err.message : "Publish failed.");
    } finally {
      setPublishing(false);
    }
  }

  if (!open) return null;

  const dirty = !!active && drafts[active.filename] !== undefined;
  const crumbs = active ? active.filename.split("/") : [];
  const showLive = previewSource === "live" && !!remoteUrl;
  const previewName = showLive ? `localhost:${previewPort}` : previewPage || htmlPages.find((p) => /(^|\/)index\.html$/i.test(p)) || htmlPages[0] || "preview";

  return (
    <div className="animate-fade-in fixed inset-0 z-40 flex justify-end bg-black/50" onClick={onClose}>
      <div
        className={`animate-scale-in relative flex h-full w-full flex-col bg-[#1b1b1b] text-[#d4d4d4] shadow-2xl ${fullscreen ? "max-w-full" : "max-w-[1040px]"}`}
        onClick={(e) => {
          e.stopPropagation();
          if (menu) setMenu(null);
        }}
      >
        {/* ------------------------------------------------ header */}
        <div className="flex h-[60px] shrink-0 items-center gap-2 border-b border-[#2a2a2a] px-3">
          <div className="relative">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setMenu(menu === "view" ? null : "view");
              }}
              className="flex h-10 items-center gap-2.5 rounded-xl border border-[#333] bg-[#242424] px-3.5 text-[15px] font-medium text-white transition-colors hover:bg-[#2a2a2a]"
            >
              <span className="text-[#c9c9c9]">{view === "code" ? Icon.code : Icon.eye}</span>
              {view === "code" ? "Code" : "Preview"}
              <span className="text-[#8a8a8a]">{Icon.down}</span>
            </button>
            {menu === "view" && (
              <div className="animate-scale-in absolute left-0 top-full z-30 mt-2 w-56 rounded-xl border border-[#333] bg-[#232323] p-1.5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                <MenuItem icon={Icon.code} label="Code" checked={view === "code"} onClick={() => { setView("code"); setMenu(null); }} />
                <MenuItem icon={Icon.eye} label="Preview" hint={showLive ? previewName : "Runs your files in the browser"} checked={view === "preview"} onClick={() => { setView("preview"); setMenu(null); }} />
                <MenuItem icon={Icon.terminal} label="Terminal" checked={terminalOpen} onClick={() => { setTerminalOpen((t) => !t); setMenu(null); }} />
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-1.5">
            {syncing && <span className="mr-1 hidden h-1.5 w-1.5 animate-pulse rounded-full bg-[#0a84ff] sm:block" title="Syncing workspace" />}

            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <IconButton
                label="More"
                active={menu === "more"}
                onClick={() => setMenu(menu === "more" ? null : "more")}
              >
                {Icon.dots}
              </IconButton>
              {menu === "more" && (
                <div className="animate-scale-in absolute right-0 top-full z-30 mt-2 w-64 rounded-xl border border-[#333] bg-[#232323] p-1.5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  <MenuItem icon={Icon.download} label={zipping ? "Zipping…" : "Download all (.zip)"} disabled={!merged.length || zipping} onClick={downloadAll} />
                  <MenuItem
                    icon={Icon.refresh}
                    label="Refresh files"
                    hint={cloud === "off" ? "Cloud workspace not connected" : cloud === "error" ? "Last refresh failed" : "Sync with the cloud workspace"}
                    onClick={() => {
                      cloudOff.current = false;
                      setMenu(null);
                      sync();
                    }}
                  />
                  <MenuItem icon={Icon.terminal} label={terminalOpen ? "Hide terminal" : "Show terminal"} onClick={() => { setTerminalOpen((t) => !t); setMenu(null); }} />
                  <MenuItem
                    icon={Icon.copy}
                    label="Copy file path"
                    disabled={!active}
                    onClick={() => {
                      if (active) navigator.clipboard?.writeText(active.filename).catch(() => undefined);
                      setMenu(null);
                    }}
                  />
                  <MenuItem label={fullscreen ? "Exit full width" : "Full width"} onClick={() => { setFullscreen((f) => !f); setMenu(null); }} />
                </div>
              )}
            </div>

            <div className="relative" onClick={(e) => e.stopPropagation()}>
              <button
                type="button"
                disabled={publishing || !merged.length}
                onClick={() => setMenu(menu === "publish" ? null : "publish")}
                className="flex h-10 items-center gap-2 rounded-xl bg-white px-3.5 text-[15px] font-medium text-[#111] transition-colors hover:bg-[#eaeaea] disabled:opacity-60"
              >
                {Icon.upload}
                {publishing ? "Publishing…" : "Publish"}
              </button>
              {needsPublish && !publishing && <span className="absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full bg-[#0a84ff] ring-2 ring-[#1b1b1b]" />}
              {menu === "publish" && (
                <div className="animate-scale-in absolute right-0 top-full z-30 mt-2 w-56 rounded-xl border border-[#333] bg-[#232323] p-1.5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
                  <MenuItem label="Publish to Vercel" hint="Uses your Vercel token" onClick={() => publish("vercel")} />
                  <MenuItem label="Publish to Netlify" hint="Uses your Netlify token" onClick={() => publish("netlify")} />
                </div>
              )}
            </div>

            <span className="mx-1 h-6 w-px bg-[#333]" />
            <IconButton label="Close" onClick={onClose}>
              {Icon.close}
            </IconButton>
          </div>
        </div>

        {/* ------------------------------------------------ status strips */}
        {publishedUrl && (
          <div className="flex items-center gap-2 border-b border-[#2a2a2a] bg-[#16261c] px-4 py-2 text-[12.5px] text-[#7fd6a0]">
            <a href={publishedUrl} target="_blank" rel="noreferrer" className="truncate underline">
              {publishedUrl}
            </a>
            {publishVerified !== null && <VerificationBadge verified={publishVerified} reason={publishReason} />}
          </div>
        )}
        {publishError && <p className="border-b border-[#2a2a2a] bg-[#2a1616] px-4 py-2 text-[12.5px] text-red-300">{publishError}</p>}
        {cloud === "off" && view === "code" && (
          <p className="border-b border-[#2a2a2a] bg-[#26210f] px-4 py-2 text-[12px] leading-snug text-[#d9c48a]">
            Cloud workspace isn&apos;t connected, so this shows the files from your chat. Add a Daytona key in Settings → Integrations for a real terminal, builds and live localhost preview.
          </p>
        )}

        {/* ------------------------------------------------ main area */}
        <div className="flex min-h-0 flex-1 flex-col">
          {view === "code" ? (
            merged.length === 0 ? (
              <div className="flex flex-1 items-center justify-center px-8 text-center text-[13.5px] leading-relaxed text-[#7d7d7d]">
                {cloud === "connecting" ? "Loading the workspace…" : "Files the agent builds will appear here as it writes them. Ask the Developer Agent to build something."}
              </div>
            ) : (
              <div className="flex min-h-0 flex-1">
                <div className="w-[38%] min-w-[132px] max-w-[250px] shrink-0 overflow-y-auto border-r border-[#2a2a2a]">
                  <FileTree paths={merged.map((f) => f.filename)} activePath={activePath} onSelect={selectFile} />
                </div>

                <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                  <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[#2a2a2a] px-4">
                    <nav className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden whitespace-nowrap text-[15px]" aria-label="File path">
                      {crumbs.map((part, i) => (
                        <span key={i} className="flex min-w-0 items-center gap-1.5">
                          {i > 0 && <span className="text-[#5e5e5e]">/</span>}
                          <span className={i === crumbs.length - 1 ? "truncate font-medium text-white" : "truncate text-[#8a8a8a]"}>{part}</span>
                        </span>
                      ))}
                      {dirty && <span className="ml-1 h-2 w-2 shrink-0 rounded-full bg-[#e2b93d]" title="Unsaved changes" />}
                    </nav>
                    {dirty && (
                      <button
                        type="button"
                        onClick={saveActive}
                        disabled={saving}
                        className="rounded-lg bg-[#0a84ff] px-3 py-1.5 text-[13px] font-medium text-white transition-colors hover:bg-[#2b94ff] disabled:opacity-60"
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                    )}
                    <IconButton label={editing ? "Stop editing" : "Edit file"} active={editing} onClick={() => setEditing((e) => !e)} disabled={!active}>
                      {Icon.pencil}
                    </IconButton>
                    <IconButton label={copied ? "Copied" : "Copy file"} onClick={copyActive} disabled={!active}>
                      {copied ? <span className="text-[#7fd6a0]">{Icon.check}</span> : Icon.copy}
                    </IconButton>
                    <IconButton label="Download file" onClick={downloadActive} disabled={!active}>
                      {Icon.download}
                    </IconButton>
                  </div>

                  {active ? (
                    <CodeEditor path={active.filename} value={active.code} editing={editing} onChange={changeActive} />
                  ) : (
                    <div className="flex flex-1 items-center justify-center text-[13px] text-[#6b6b6b]">Pick a file from the tree.</div>
                  )}
                </div>
              </div>
            )
          ) : (
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-[#2a2a2a] px-3">
                <IconButton label="Reload preview" onClick={() => setPreviewKey((k) => k + 1)}>
                  {Icon.refresh}
                </IconButton>
                <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-[#2f2f2f] bg-[#232323] px-3 py-1.5 text-[13px]">
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${showLive ? "bg-emerald-400" : "bg-[#6b6b6b]"}`} />
                  <span className="truncate text-[#d0d0d0]">{previewName}</span>
                </div>
                {remoteUrl && (
                  <div className="flex shrink-0 overflow-hidden rounded-lg border border-[#2f2f2f] text-[12px]">
                    <button type="button" onClick={() => setPreviewSource("live")} className={`px-2.5 py-1.5 ${showLive ? "bg-[#2f2f2f] text-white" : "text-[#8a8a8a] hover:bg-[#242424]"}`}>
                      Live
                    </button>
                    <button type="button" onClick={() => setPreviewSource("static")} className={`px-2.5 py-1.5 ${!showLive ? "bg-[#2f2f2f] text-white" : "text-[#8a8a8a] hover:bg-[#242424]"}`}>
                      Static
                    </button>
                  </div>
                )}
                {!showLive && htmlPages.length > 1 && (
                  <select
                    value={previewPage || htmlPages.find((p) => /(^|\/)index\.html$/i.test(p)) || htmlPages[0]}
                    onChange={(e) => setPreviewPage(e.target.value)}
                    className="max-w-[130px] shrink-0 rounded-lg border border-[#2f2f2f] bg-[#232323] px-2 py-1.5 text-[12px] text-[#d0d0d0] outline-none"
                  >
                    {htmlPages.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                )}
                <div className="flex shrink-0 items-center gap-1">
                  <input
                    value={previewPort}
                    onChange={(e) => setPreviewPort(e.target.value.replace(/\D/g, "").slice(0, 5))}
                    onKeyDown={(e) => e.key === "Enter" && openLive(Number(previewPort) || 3000)}
                    aria-label="Preview port"
                    className="w-14 rounded-lg border border-[#2f2f2f] bg-[#232323] px-2 py-1.5 text-center text-[12px] text-[#d0d0d0] outline-none focus:border-[#4a4a4a]"
                  />
                  <button type="button" onClick={() => openLive(Number(previewPort) || 3000)} className="rounded-lg border border-[#2f2f2f] px-2.5 py-1.5 text-[12px] text-[#c4c4c4] transition-colors hover:bg-[#262626]">
                    Open
                  </button>
                </div>
                {showLive && remoteUrl && (
                  <a href={remoteUrl} target="_blank" rel="noreferrer" aria-label="Open in a new tab" title="Open in a new tab" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-[#c4c4c4] hover:bg-[#262626] hover:text-white">
                    {Icon.external}
                  </a>
                )}
              </div>

              <div className="relative min-h-0 flex-1 bg-white">
                {showLive && remoteUrl ? (
                  <iframe
                    key={`live-${previewKey}`}
                    ref={iframeRef}
                    title="Live preview"
                    src={remoteUrl}
                    allow="fullscreen; clipboard-read; clipboard-write; xr-spatial-tracking"
                    sandbox="allow-scripts allow-forms allow-same-origin allow-popups allow-modals"
                    className="h-full w-full border-0 bg-white"
                  />
                ) : staticHtml ? (
                  <iframe
                    key={`static-${previewKey}`}
                    ref={iframeRef}
                    title="Static preview"
                    srcDoc={staticHtml}
                    allow="fullscreen; xr-spatial-tracking"
                    // No allow-same-origin: generated code must not reach the app's login/session storage.
                    sandbox="allow-scripts allow-forms allow-popups allow-modals"
                    className="h-full w-full border-0 bg-white"
                  />
                ) : (
                  <div className="flex h-full items-center justify-center bg-[#1b1b1b] px-8 text-center text-[13.5px] leading-relaxed text-[#7d7d7d]">
                    Nothing to preview yet. Add an index.html, or start a dev server in the Terminal — it opens here on localhost automatically.
                  </div>
                )}
                {previewError && (
                  <div className="absolute inset-x-2 bottom-2 flex items-start gap-2 rounded-lg bg-[#3b1414]/95 px-3 py-2 text-[12px] text-red-200 shadow-lg">
                    <span className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono">{previewError}</span>
                    <button type="button" onClick={() => setPreviewError(null)} className="shrink-0 text-red-300 hover:text-white" aria-label="Dismiss error">
                      {Icon.close}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ------------------------------------------------ terminal drawer */}
          {terminalOpen && (
            <div className="flex h-[38%] min-h-[210px] shrink-0 flex-col border-t border-[#2a2a2a]">
              <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[#262626] bg-[#171717] px-4">
                <span className="text-[#8a8a8a]">{Icon.terminal}</span>
                <span className="text-[12.5px] font-medium text-[#c4c4c4]">Terminal</span>
                <span className={`h-1.5 w-1.5 rounded-full ${cloud === "ready" ? "bg-emerald-400" : cloud === "off" ? "bg-amber-400" : "bg-[#6b6b6b]"}`} />
                <span className="text-[11px] text-[#6b6b6b]">{cloud === "ready" ? "cloud workspace" : cloud === "off" ? "not connected" : "connecting"}</span>
                <button type="button" onClick={() => setTerminalOpen(false)} className="ml-auto text-[#8a8a8a] hover:text-white" aria-label="Hide terminal">
                  {Icon.down}
                </button>
              </div>
              <div className="min-h-0 flex-1">
                <TerminalPane
                  onPortDetected={openLive}
                  onWorkspaceStatus={(ready) => {
                    if (ready) {
                      cloudOff.current = false;
                      setCloud("ready");
                    } else {
                      cloudOff.current = true;
                      setCloud("off");
                    }
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {note && (
          <div className="pointer-events-none absolute inset-x-0 bottom-4 z-40 flex justify-center px-4">
            <span className="animate-fade-in-up max-w-md rounded-xl border border-[#3a3a3a] bg-[#2a2a2a] px-4 py-2.5 text-[13px] text-white shadow-xl">{note}</span>
          </div>
        )}
      </div>
    </div>
  );
}