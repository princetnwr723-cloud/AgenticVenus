"use client";

import { useEffect, useMemo, useState } from "react";
import { ensureAgentWorkspace, getAgentPreview, runAgentCommand } from "@/lib/workspaceClient";
import { INSTALLED_CHECK_CMD } from "@/lib/terminalOrchestrator";

type Props = { open: boolean; onClose: () => void };

export default function CloudWorkspacePanel({ open, onClose }: Props) {
  const [command, setCommand] = useState("");
  const [output, setOutput] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [workspace, setWorkspace] = useState<{ sandboxId: string; state?: string; workDir?: string } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewPort, setPreviewPort] = useState("3000");
  const [checkingInstalled, setCheckingInstalled] = useState(false);
  const [installed, setInstalled] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    ensureAgentWorkspace().then(setWorkspace).catch((e) => setOutput((x) => [...x, `✕ ${e instanceof Error ? e.message : String(e)}`]));
  }, [open]);

  const status = useMemo(() => workspace?.state || "connecting", [workspace]);

  async function execute(e?: React.FormEvent) {
    e?.preventDefault();
    const cmd = command.trim();
    if (!cmd || busy) return;
    setCommand("");
    setBusy(true);
    setOutput((x) => [...x, `$ ${cmd}`]);
    try {
      const result = await runAgentCommand(cmd);
      setOutput((x) => [...x, result.output || `(exit ${result.exitCode ?? 0})`, `exit ${result.exitCode ?? 0}`]);
    } catch (err) {
      setOutput((x) => [...x, `✕ ${err instanceof Error ? err.message : String(err)}`]);
    } finally {
      setBusy(false);
    }
  }

  async function checkInstalled() {
    setCheckingInstalled(true);
    setInstalled(null);
    try {
      const result = await runAgentCommand(INSTALLED_CHECK_CMD, undefined, 60);
      setInstalled(result.output || "(nothing reported)");
    } catch (err) {
      setInstalled(err instanceof Error ? err.message : "Couldn't check.");
    } finally {
      setCheckingInstalled(false);
    }
  }

  async function openPreview() {
    try {
      const result = await getAgentPreview(Number(previewPort) || 3000);
      setPreviewUrl(result.url);
    } catch (err) {
      setOutput((x) => [...x, `✕ Preview: ${err instanceof Error ? err.message : String(err)}`]);
    }
  }

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={onClose}>
      <div className="flex h-full w-full max-w-5xl flex-col bg-[#171614] text-cream shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div>
            <div className="text-sm font-semibold">AgenticVenus Cloud Workspace</div>
            <div className="mt-1 text-[11px] text-cream/40">
              Persistent Daytona workspace · {status} — the shared &quot;global&quot; project. Each chat's own build lives separately in its
              Codespace.
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={checkInstalled} disabled={checkingInstalled} className="rounded border border-white/10 px-3 py-1.5 text-xs text-cream/70 hover:text-cream disabled:opacity-50">
              {checkingInstalled ? "Checking…" : "What's installed?"}
            </button>
            <button onClick={onClose} className="rounded border border-white/10 px-3 py-1.5 text-xs text-cream/60 hover:text-cream">
              Close
            </button>
          </div>
        </header>

        {installed && (
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap border-b border-white/10 bg-[#111] px-4 py-3 font-mono text-[11px] leading-relaxed text-cream/75">
            {installed}
          </pre>
        )}

        <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[1fr_1fr]">
          <section className="flex min-h-0 flex-col border-b border-white/10 lg:border-b-0 lg:border-r">
            <div className="border-b border-white/10 px-4 py-3 text-xs text-cream/50">
              Terminal — both you and the agent can run commands here (ask it in chat, e.g. &quot;install ffmpeg&quot;)
            </div>
            <div className="flex-1 overflow-auto bg-[#0d0d0c] p-4 font-mono text-xs leading-relaxed">
              {output.length ? output.map((line, i) => <div key={i} className="whitespace-pre-wrap break-words text-cream/75">{line}</div>) : <div className="text-cream/30">Agent terminal ready.</div>}
            </div>
            <form onSubmit={execute} className="flex border-t border-white/10 bg-[#11110f] p-3">
              <span className="mr-2 pt-2 font-mono text-xs text-moss">$</span>
              <input value={command} onChange={(e) => setCommand(e.target.value)} placeholder="npm install, pip install ..., apt-get install -y ..., ls -la..." className="min-w-0 flex-1 bg-transparent font-mono text-xs text-cream outline-none" autoComplete="off" />
              <button disabled={busy} className="ml-3 rounded bg-white/10 px-3 py-1.5 text-xs disabled:opacity-40">{busy ? "Running" : "Run"}</button>
            </form>
          </section>

          <section className="flex min-h-0 flex-col">
            <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
              <span className="text-xs text-cream/50">Live Preview</span>
              <input value={previewPort} onChange={(e) => setPreviewPort(e.target.value)} className="w-16 rounded border border-white/10 bg-white/5 px-2 py-1 text-xs outline-none" />
              <button onClick={openPreview} className="rounded border border-white/10 px-2.5 py-1 text-xs hover:bg-white/10">Open</button>
              {workspace && <span className="ml-auto text-[10px] text-cream/25">{workspace.sandboxId.slice(0, 10)}…</span>}
            </div>
            {previewUrl ? <iframe title="Agent live preview" src={previewUrl} className="min-h-0 flex-1 border-0 bg-white" /> : <div className="flex flex-1 items-center justify-center p-8 text-center text-xs text-cream/30">Start your dev server in the terminal, then enter its port and press Open.</div>}
          </section>
        </div>
      </div>
    </div>
  );
}