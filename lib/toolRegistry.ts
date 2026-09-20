"use client";

import { useEffect, useState, type FormEvent } from "react";
import type { CodeFile } from "@/lib/codeExtract";
import type { Attachment } from "@/lib/chatClient";
import { buildPreviewHtml, listHtmlPages } from "@/lib/preview";
import { publishProject } from "@/lib/publishClient";
import VerificationBadge from "@/components/VerificationBadge";
import {
  writeAgentFile,
  ensureAgentWorkspace,
  listAgentFiles,
  runAgentSessionCommand,
  getAgentPreview,
} from "@/lib/workspaceClient";

type Props = {
  open: boolean;
  onClose: () => void;
  files: CodeFile[];
  assets?: Attachment[];
  openFileId?: string | null;
  livePreviewUrl?: string | null;
};

/**
 * Detect the language from a filename.
 *
 * This is intentionally kept inside CodespacePanel so we do not depend
 * on a missing export from lib/preview.ts.
 */
function languageFromPath(filename: string): string {
  const path = filename.toLowerCase();

  if (path.endsWith(".tsx")) return "typescriptreact";
  if (path.endsWith(".ts")) return "typescript";
  if (path.endsWith(".jsx")) return "javascriptreact";
  if (path.endsWith(".js")) return "javascript";
  if (path.endsWith(".mjs")) return "javascript";
  if (path.endsWith(".cjs")) return "javascript";

  if (path.endsWith(".css")) return "css";
  if (path.endsWith(".scss")) return "scss";
  if (path.endsWith(".sass")) return "sass";
  if (path.endsWith(".less")) return "less";

  if (path.endsWith(".html")) return "html";
  if (path.endsWith(".json")) return "json";
  if (path.endsWith(".md")) return "markdown";
  if (path.endsWith(".mdx")) return "mdx";

  if (path.endsWith(".py")) return "python";
  if (path.endsWith(".go")) return "go";
  if (path.endsWith(".rs")) return "rust";
  if (path.endsWith(".java")) return "java";
  if (path.endsWith(".c")) return "c";
  if (path.endsWith(".cpp")) return "cpp";
  if (path.endsWith(".h")) return "c";
  if (path.endsWith(".hpp")) return "cpp";

  if (path.endsWith(".sh")) return "shell";
  if (path.endsWith(".bash")) return "shell";
  if (path.endsWith(".zsh")) return "shell";

  if (path.endsWith(".yml")) return "yaml";
  if (path.endsWith(".yaml")) return "yaml";
  if (path.endsWith(".xml")) return "xml";
  if (path.endsWith(".svg")) return "xml";

  if (path.endsWith(".sql")) return "sql";
  if (path.endsWith(".graphql")) return "graphql";
  if (path.endsWith(".gql")) return "graphql";

  return "plaintext";
}

function groupByFolder(files: CodeFile[]): Map<string, CodeFile[]> {
  const groups = new Map<string, CodeFile[]>();

  for (const file of files) {
    const parts = file.filename.split("/");
    const folder =
      parts.length > 1 ? parts.slice(0, -1).join("/") : "";

    if (!groups.has(folder)) {
      groups.set(folder, []);
    }

    groups.get(folder)!.push(file);
  }

  return groups;
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";

  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 1000);
}

export default function CodespacePanel({
  open,
  onClose,
  files,
  assets = [],
  openFileId = null,
  livePreviewUrl = null,
}: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  const [viewMode, setViewMode] =
    useState<"code" | "preview">("code");

  const [copied, setCopied] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const [previewPage, setPreviewPage] =
    useState<string | null>(null);

  const [editedCode, setEditedCode] = useState("");
  const [savingCode, setSavingCode] = useState(false);
  const [saveMessage, setSaveMessage] =
    useState<string | null>(null);

  const [publishing, setPublishing] = useState(false);
  const [publishMenuOpen, setPublishMenuOpen] =
    useState(false);

  const [publishedUrl, setPublishedUrl] =
    useState<string | null>(null);

  const [publishVerified, setPublishVerified] =
    useState<boolean | null>(null);

  const [publishReason, setPublishReason] =
    useState<string>("");

  const [publishError, setPublishError] =
    useState<string | null>(null);

  const [terminalLines, setTerminalLines] =
    useState<string[]>([]);

  const [terminalCommand, setTerminalCommand] =
    useState("");

  const [terminalBusy, setTerminalBusy] =
    useState(false);

  const [workspaceReady, setWorkspaceReady] =
    useState(false);

  const [terminalOpen, setTerminalOpen] =
    useState(true);

  const [livePort, setLivePort] =
    useState("3000");

  const [livePreviewMessage, setLivePreviewMessage] =
    useState<string | null>(null);

  const [workspaceFiles, setWorkspaceFiles] =
    useState<CodeFile[]>([]);

  const [workspaceSyncing, setWorkspaceSyncing] =
    useState(false);

  useEffect(() => {
    if (livePreviewUrl) {
      setViewMode("preview");
    }
  }, [livePreviewUrl]);

  useEffect(() => {
    if (open && openFileId) {
      setActiveId(openFileId);
      setViewMode("code");
    }
  }, [open, openFileId]);

  /**
   * Sync the persistent remote workspace into the Codespace.
   *
   * IMPORTANT:
   * CodeFile requires:
   * id
   * filename
   * language
   * code
   *
   * The previous version forgot `language`, which caused the Vercel
   * TypeScript error.
   */
  async function syncWorkspace() {
    if (!open) return;

    try {
      setWorkspaceSyncing(true);

      await ensureAgentWorkspace();

      const remote = await listAgentFiles(true);

      const mapped: CodeFile[] = remote.map((file) => ({
        id: `workspace:${file.path}`,
        filename: file.path,
        language: languageFromPath(file.path),
        code: file.content || "",
      }));

      setWorkspaceFiles(mapped);
      setWorkspaceReady(true);

      if (!activeId && mapped.length > 0) {
        setActiveId(mapped[mapped.length - 1].id);
      }
    } catch (error) {
      setTerminalLines((current) => [
        ...current,
        `✕ Workspace sync: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      ]);
    } finally {
      setWorkspaceSyncing(false);
    }
  }

  useEffect(() => {
    if (!open) return;

    syncWorkspace();

    const timer = window.setInterval(() => {
      syncWorkspace();
    }, 2000);

    return () => {
      window.clearInterval(timer);
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  /**
   * Prefer the persistent remote workspace.
   * Fall back to files extracted from the chat if the remote workspace
   * has not been populated yet.
   */
  const displayFiles =
    workspaceFiles.length > 0
      ? workspaceFiles
      : files;

  useEffect(() => {
    const current =
      displayFiles.find(
        (file) => file.id === activeId
      ) ??
      displayFiles[displayFiles.length - 1];

    setEditedCode(current?.code || "");
    setSaveMessage(null);
  }, [activeId, workspaceFiles, files]);

  if (!open) {
    return null;
  }

  const active =
    displayFiles.find(
      (file) => file.id === activeId
    ) ??
    displayFiles[displayFiles.length - 1];

  const htmlPages = listHtmlPages(displayFiles);

  const previewHtml = buildPreviewHtml(
    displayFiles,
    assets,
    previewPage || undefined
  );

  const grouped = groupByFolder(displayFiles);

  async function handleCopy() {
    if (!active) return;

    try {
      await navigator.clipboard.writeText(
        active.code
      );

      setCopied(true);

      setTimeout(() => {
        setCopied(false);
      }, 1500);
    } catch {
      // Clipboard may be unavailable in some browsers.
    }
  }

  async function handlePublish(
    target: "vercel" | "netlify"
  ) {
    if (displayFiles.length === 0) return;

    setPublishMenuOpen(false);
    setPublishing(true);

    setPublishError(null);
    setPublishedUrl(null);
    setPublishVerified(null);

    try {
      const result = await publishProject(
        target,
        displayFiles
      );

      setPublishedUrl(result.url);
      setPublishVerified(result.verified);
      setPublishReason(
        result.verificationReason
      );
    } catch (error) {
      setPublishError(
        error instanceof Error
          ? error.message
          : "Publish failed."
      );
    } finally {
      setPublishing(false);
    }
  }

  async function handleDownloadFile() {
    if (!active) return;

    const safeName =
      active.filename.split("/").pop() ||
      active.filename;

    triggerDownload(
      new Blob(
        [active.code],
        { type: "text/plain" }
      ),
      safeName
    );
  }

  async function handleSaveToCloud() {
    if (!active || savingCode) return;

    setSavingCode(true);
    setSaveMessage(null);

    try {
      await writeAgentFile(
        active.filename,
        editedCode
      );

      setSaveMessage(
        "Saved to cloud workspace ✓"
      );

      /**
       * Update local workspace state immediately so the editor
       * doesn't visually revert before the next 2s sync.
       */
      setWorkspaceFiles((current) =>
        current.map((file) =>
          file.id === active.id
            ? {
                ...file,
                code: editedCode,
              }
            : file
        )
      );
    } catch (error) {
      setSaveMessage(
        error instanceof Error
          ? error.message
          : "Cloud save failed."
      );
    } finally {
      setSavingCode(false);
    }
  }

  async function runTerminal(
    event?: FormEvent
  ) {
    event?.preventDefault();

    const command = terminalCommand.trim();

    if (!command || terminalBusy) {
      return;
    }

    setTerminalCommand("");
    setTerminalBusy(true);

    setTerminalLines((current) => [
      ...current,
      `$ ${command}`,
    ]);

    try {
      const result =
        await runAgentSessionCommand(
          command,
          "agenticvenus-terminal",
          false
        );

      const output =
        result.output ||
        result.stdout ||
        result.stderr ||
        "";

      setTerminalLines((current) => [
        ...current,
        output ||
          `(exit ${result.exitCode ?? 0})`,
        `exit ${result.exitCode ?? 0}`,
      ]);
    } catch (error) {
      setTerminalLines((current) => [
        ...current,
        `✕ ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      ]);
    } finally {
      setTerminalBusy(false);
    }
  }

  async function openLivePreview() {
    try {
      const result = await getAgentPreview(
        Number(livePort) || 3000
      );

      setLivePreviewMessage(result.url);
      setViewMode("preview");
    } catch (error) {
      setTerminalLines((current) => [
        ...current,
        `✕ Preview: ${
          error instanceof Error
            ? error.message
            : String(error)
        }`,
      ]);
    }
  }

  async function handleDownloadAll() {
    if (displayFiles.length === 0) {
      return;
    }

    setZipping(true);

    try {
      const JSZip =
        (await import("jszip")).default;

      const zip = new JSZip();

      for (const file of displayFiles) {
        zip.file(
          file.filename,
          file.code
        );
      }

      const blob =
        await zip.generateAsync({
          type: "blob",
        });

      triggerDownload(
        blob,
        "agenticvenus-project.zip"
      );
    } finally {
      setZipping(false);
    }
  }

  const hasPreview =
    Boolean(
      previewHtml ||
      livePreviewUrl ||
      livePreviewMessage
    );

  return (
    <div
      className="animate-fade-in fixed inset-0 z-40 flex justify-end bg-ink/30"
      onClick={onClose}
    >
      <div
        className={`animate-scale-in flex h-full w-full flex-col bg-[#1e1c19] text-cream shadow-2xl transition-all ${
          fullscreen
            ? "max-w-full"
            : "max-w-3xl"
        }`}
        onClick={(event) =>
          event.stopPropagation()
        }
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-[#4D6BFE]" />

            <h2 className="text-sm font-medium">
              Codespace — Developer Agent
            </h2>
          </div>

          <div className="flex items-center gap-2">
            {hasPreview && (
              <div className="flex overflow-hidden rounded-md border border-white/15 text-xs">
                <button
                  onClick={() =>
                    setViewMode("code")
                  }
                  className={`px-3 py-1.5 transition-colors ${
                    viewMode === "code"
                      ? "bg-white/15 text-cream"
                      : "text-cream/50 hover:bg-white/5"
                  }`}
                >
                  Code
                </button>

                <button
                  onClick={() =>
                    setViewMode("preview")
                  }
                  className={`px-3 py-1.5 transition-colors ${
                    viewMode === "preview"
                      ? "bg-white/15 text-cream"
                      : "text-cream/50 hover:bg-white/5"
                  }`}
                >
                  Preview
                </button>
              </div>
            )}

            {displayFiles.length > 0 && (
              <div className="relative">
                <button
                  onClick={() =>
                    setPublishMenuOpen(
                      (open) => !open
                    )
                  }
                  disabled={publishing}
                  className="focus-ring rounded-md border border-moss/30 bg-moss/10 px-2.5 py-1 text-xs font-medium text-moss transition-colors hover:bg-moss/20 disabled:opacity-50"
                >
                  {publishing
                    ? "Publishing..."
                    : "Publish"}
                </button>

                {publishMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-20 mt-1 w-44 rounded-md border border-white/15 bg-[#2a2723] p-1 shadow-xl"
                    onMouseLeave={() =>
                      setPublishMenuOpen(false)
                    }
                  >
                    <button
                      onClick={() =>
                        handlePublish("vercel")
                      }
                      className="block w-full rounded px-3 py-2 text-left text-xs text-cream/80 hover:bg-white/10"
                    >
                      Publish to Vercel
                    </button>

                    <button
                      onClick={() =>
                        handlePublish("netlify")
                      }
                      className="block w-full rounded px-3 py-2 text-left text-xs text-cream/80 hover:bg-white/10"
                    >
                      Publish to Netlify
                    </button>
                  </div>
                )}
              </div>
            )}

            {displayFiles.length > 0 && (
              <button
                onClick={handleDownloadAll}
                disabled={zipping}
                className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-xs text-cream/70 transition-colors hover:bg-white/10 hover:text-cream disabled:opacity-50"
              >
                {zipping
                  ? "Zipping..."
                  : "Download all"}
              </button>
            )}

            <button
              onClick={() =>
                setFullscreen(
                  (value) => !value
                )
              }
              aria-label={
                fullscreen
                  ? "Exit fullscreen"
                  : "Fullscreen"
              }
              className="focus-ring rounded-md border border-white/15 p-1.5 text-cream/60 hover:text-cream"
            >
              {fullscreen ? (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M5.5 2H2v3.5M8.5 12H12V8.5M12 2H8.5M2 8.5V12h3.5"
                    stroke="currentColor"
                    strokeWidth="1.3"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 5.5V2h3.5M12 5.5V2H8.5M2 8.5V12h3.5M12 8.5V12H8.5"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>

            <button
              onClick={onClose}
              aria-label="Close"
              className="focus-ring rounded-md p-1 text-cream/60 hover:text-cream"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Main area */}
        {displayFiles.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-cream/40">
            The Developer Agent hasn&apos;t
            written any code in this chat yet.
            Ask it to build something and files
            will show up here.
          </div>
        ) : viewMode === "preview" &&
          hasPreview ? (
          <div className="flex h-full w-full flex-1 flex-col">
            {htmlPages.length > 1 && (
              <div className="flex items-center gap-2 border-b border-white/10 bg-[#1e1c19] px-4 py-2">
                <span className="text-xs text-cream/50">
                  Page:
                </span>

                <select
                  value={
                    previewPage ||
                    htmlPages.find((page) =>
                      /index\.html$/i.test(
                        page
                      )
                    ) ||
                    htmlPages[0]
                  }
                  onChange={(event) =>
                    setPreviewPage(
                      event.target.value
                    )
                  }
                  className="rounded-md border border-white/15 bg-[#2a2723] px-2 py-1 text-xs text-cream outline-none"
                >
                  {htmlPages.map((page) => (
                    <option
                      key={page}
                      value={page}
                    >
                      {page}
                    </option>
                  ))}
                </select>

                <span className="text-xs text-cream/30">
                  Links between pages won&apos;t
                  navigate here — switch pages
                  with this dropdown instead.
                </span>
              </div>
            )}

            {/* Real live preview URL */}
            {livePreviewUrl ||
            livePreviewMessage ? (
              <iframe
                title="Codespace live preview"
                src={
                  livePreviewUrl ||
                  livePreviewMessage ||
                  undefined
                }
                sandbox="allow-scripts allow-forms allow-same-origin"
                className="h-full w-full flex-1 border-0 bg-white"
              />
            ) : previewHtml ? (
              /* Static generated preview */
              <iframe
                title="Codespace static preview"
                srcDoc={previewHtml}
                sandbox="allow-scripts allow-modals allow-forms allow-same-origin"
                className="h-full w-full flex-1 border-0 bg-white"
              />
            ) : (
              <div className="flex flex-1 items-center justify-center text-sm text-cream/40">
                Preview is not ready yet.
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">
            {/* File tree */}
            <div className="w-56 shrink-0 overflow-y-auto border-r border-white/10 py-2">
              {Array.from(
                grouped.entries()
              ).map(
                ([folder, folderFiles]) => (
                  <div
                    key={
                      folder || "__root"
                    }
                  >
                    {folder && (
                      <p className="px-4 pb-1 pt-3 text-[10px] font-medium uppercase tracking-wide text-cream/30">
                        {folder}
                      </p>
                    )}

                    {folderFiles.map(
                      (file) => (
                        <button
                          key={file.id}
                          onClick={() =>
                            setActiveId(
                              file.id
                            )
                          }
                          className={`block w-full truncate px-4 py-2 text-left text-xs transition-colors ${
                            (
                              active?.id ??
                              displayFiles[
                                displayFiles.length -
                                  1
                              ]?.id
                            ) === file.id
                              ? "bg-white/10 text-cream"
                              : "text-cream/50 hover:bg-white/5 hover:text-cream/80"
                          }`}
                        >
                          {file.filename
                            .split("/")
                            .pop()}
                        </button>
                      )
                    )}
                  </div>
                )
              )}
            </div>

            {/* Editor */}
            <div className="flex-1 overflow-auto p-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="min-w-0 truncate text-xs text-cream/40">
                  {active?.filename}
                </p>

                <div className="flex shrink-0 gap-2">
                  <button
                    onClick={
                      handleSaveToCloud
                    }
                    disabled={
                      savingCode ||
                      !active
                    }
                    className="focus-ring rounded-md border border-moss/30 bg-moss/10 px-2.5 py-1 text-xs text-moss transition-colors hover:bg-moss/20 disabled:opacity-50"
                  >
                    {savingCode
                      ? "Saving..."
                      : "Save to Cloud"}
                  </button>

                  <button
                    onClick={
                      handleDownloadFile
                    }
                    disabled={!active}
                    className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-xs text-cream/70 transition-colors hover:bg-white/10 hover:text-cream disabled:opacity-50"
                  >
                    Download
                  </button>

                  <button
                    onClick={handleCopy}
                    disabled={!active}
                    className="focus-ring rounded-md border border-white/15 px-2.5 py-1 text-xs text-cream/70 transition-colors hover:bg-white/10 hover:text-cream disabled:opacity-50"
                  >
                    {copied
                      ? "Copied ✓"
                      : "Copy"}
                  </button>
                </div>
              </div>

              <textarea
                value={editedCode}
                onChange={(event) => {
                  setEditedCode(
                    event.target.value
                  );
                  setSaveMessage(null);
                }}
                spellCheck={false}
                className="h-full min-h-[420px] w-full resize-none rounded-md border border-white/10 bg-[#141311] p-4 font-mono text-[13px] leading-relaxed text-cream/90 outline-none focus:border-white/20"
                aria-label={
                  active?.filename ||
                  "Code editor"
                }
              />

              {saveMessage && (
                <p className="mt-2 text-[11px] text-cream/40">
                  {saveMessage}
                </p>
              )}
            </div>
          </div>
        )}

        {/* Terminal */}
        <div
          className={`${
            terminalOpen
              ? "h-56"
              : "h-10"
          } shrink-0 border-t border-white/10 bg-[#0d0d0c]`}
        >
          <div className="flex h-10 items-center gap-2 border-b border-white/10 px-4">
            <button
              onClick={() =>
                setTerminalOpen(
                  (value) => !value
                )
              }
              className="text-xs font-medium text-cream/70"
            >
              {terminalOpen
                ? "⌄"
                : "›"}{" "}
              Terminal
            </button>

            <span
              className={`h-1.5 w-1.5 rounded-full ${
                workspaceReady
                  ? "bg-moss"
                  : "bg-clay"
              }`}
            />

            <span className="text-[10px] text-cream/30">
              {workspaceReady
                ? `Persistent workspace${
                    workspaceSyncing
                      ? " · syncing"
                      : ""
                  }`
                : "Connecting…"}
            </span>

            <div className="ml-auto flex items-center gap-1">
              <input
                value={livePort}
                onChange={(event) =>
                  setLivePort(
                    event.target.value
                  )
                }
                className="w-14 rounded border border-white/10 bg-white/5 px-1.5 py-1 text-[10px] text-cream outline-none"
                aria-label="Preview port"
              />

              <button
                onClick={
                  openLivePreview
                }
                className="rounded border border-white/10 px-2 py-1 text-[10px] text-cream/60 hover:bg-white/10 hover:text-cream"
              >
                Open preview
              </button>
            </div>
          </div>

          {terminalOpen && (
            <div className="flex h-[calc(100%-2.5rem)] flex-col">
              <div className="flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed text-cream/70">
                {terminalLines.length >
                0 ? (
                  terminalLines.map(
                    (line, index) => (
                      <div
                        key={`${index}-${line.slice(
                          0,
                          20
                        )}`}
                        className="whitespace-pre-wrap break-words"
                      >
                        {line}
                      </div>
                    )
                  )
                ) : (
                  <div className="text-cream/25">
                    Terminal ready. Try npm
                    install, npm run build,
                    npm run dev, git status…
                  </div>
                )}
              </div>

              <form
                onSubmit={runTerminal}
                className="flex border-t border-white/10 px-3 py-2"
              >
                <span className="mr-2 font-mono text-xs text-moss">
                  $
                </span>

                <input
                  value={terminalCommand}
                  onChange={(event) =>
                    setTerminalCommand(
                      event.target.value
                    )
                  }
                  placeholder="Run a command…"
                  className="min-w-0 flex-1 bg-transparent font-mono text-xs text-cream outline-none placeholder:text-cream/25"
                />

                <button
                  type="submit"
                  disabled={terminalBusy}
                  className="ml-2 rounded bg-white/10 px-3 py-1 text-[11px] text-cream disabled:opacity-40"
                >
                  {terminalBusy
                    ? "Running"
                    : "Run"}
                </button>
              </form>
            </div>
          )}
        </div>

        {/* Published URL */}
        {publishedUrl && (
          <div className="flex items-center gap-2 border-t border-white/10 bg-moss/10 px-5 py-2 text-xs text-moss">
            <a
              href={publishedUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              {publishedUrl}
            </a>

            {publishVerified !==
              null && (
              <VerificationBadge
                verified={
                  publishVerified
                }
                reason={
                  publishReason
                }
              />
            )}
          </div>
        )}

        {/* Publish error */}
        {publishError && (
          <p className="border-t border-white/10 bg-red-950/40 px-5 py-2 text-xs text-red-300">
            {publishError}
          </p>
        )}

        {/* No static preview message */}
        {displayFiles.length > 0 &&
          !previewHtml &&
          viewMode === "code" &&
          !publishedUrl &&
          !publishError && (
            <p className="border-t border-white/10 px-5 py-2 text-xs text-cream/35">
              No static preview for this
              file type — hit{" "}
              <strong className="text-clay">
                Publish
              </strong>{" "}
              above to put it on a real live
              URL instead.
            </p>
          )}
      </div>
    </div>
  );
}