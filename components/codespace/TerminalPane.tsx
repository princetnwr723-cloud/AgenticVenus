"use client";

// components/codespace/TerminalPane.tsx
// A real terminal into the persistent cloud workspace (Daytona). Commands run
// inside the project folder in a persistent shell session (cd persists).
// Long-running commands (npm run dev, vite, next dev, http.server …) are
// started in their own background session, their output is streamed back, and
// the moment a server starts listening the parent is told the port so the
// Preview tab can open localhost:<port> automatically.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getAgentSessionLogs, listAgentPorts, runAgentSessionCommand } from "@/lib/workspaceClient";

const SHELL_SESSION = "agenticvenus-terminal";
const LONG_RUNNING =
  /(^|\s)(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|preview)\b|\b(vite|next\s+dev|nodemon|live-server|http\.server|npx\s+serve|astro\s+dev)\b|&\s*$/i;

type Props = {
  onPortDetected: (port: number) => void;
  onWorkspaceStatus?: (ready: boolean) => void;
};

const QUICK = ["ls", "npm install", "npm run dev", "npm run build"];

export default function TerminalPane({ onPortDetected, onWorkspaceStatus }: Props) {
  const [lines, setLines] = useState<string[]>([]);
  const [command, setCommand] = useState("");
  const [busy, setBusy] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const history = useRef<string[]>([]);
  const historyIndex = useRef(-1);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [lines]);

  const print = (...next: string[]) => setLines((cur) => [...cur.slice(-400), ...next]);

  async function runLongRunning(cmd: string) {
    const session = `agenticvenus-bg-${Date.now()}`;
    const started = await runAgentSessionCommand(cmd, session, true);
    onWorkspaceStatus?.(true);
    print("↳ started in the background — waiting for it to listen on a port…");

    const before = new Set(await listAgentPorts().catch(() => [] as number[]));
    let printed = "";
    let foundPort: number | null = null;

    for (let attempt = 0; attempt < 14 && !foundPort; attempt++) {
      await new Promise((r) => setTimeout(r, 1200));
      if (started.cmdId) {
        try {
          const logs = await getAgentSessionLogs(session, started.cmdId);
          if (logs.length > printed.length) {
            print(...logs.slice(printed.length).split("\n").filter((l) => l.trim()));
            printed = logs;
          }
          const fromLogs = logs.match(/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{3,5})/);
          if (fromLogs) foundPort = parseInt(fromLogs[1], 10);
        } catch {
          // logs are best-effort
        }
      }
      if (!foundPort) {
        const now = await listAgentPorts().catch(() => [] as number[]);
        const fresh = now.find((p) => !before.has(p) && p >= 3000 && p <= 9999);
        if (fresh) foundPort = fresh;
      }
    }

    if (foundPort) {
      print(`✓ listening on localhost:${foundPort} — opening preview`);
      onPortDetected(foundPort);
    } else {
      print("(no port detected yet — if your server uses a custom port, type it in the Preview tab)");
    }
  }

  async function run(e?: FormEvent, override?: string) {
    e?.preventDefault();
    const cmd = (override ?? command).trim();
    if (!cmd || busy) return;
    setCommand("");
    history.current.push(cmd);
    historyIndex.current = -1;
    setBusy(true);
    print(`$ ${cmd}`);
    try {
      if (LONG_RUNNING.test(cmd)) {
        await runLongRunning(cmd.replace(/&\s*$/, ""));
      } else {
        const result = await runAgentSessionCommand(cmd, SHELL_SESSION, false);
        onWorkspaceStatus?.(true);
        const output = result.output || result.stdout || result.stderr || "";
        print(...(output ? output.replace(/\n$/, "").split("\n") : []), `exit ${result.exitCode ?? 0}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.startsWith("NO_DAYTONA")) onWorkspaceStatus?.(false);
      print(`✕ ${message}`);
    } finally {
      setBusy(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowUp" && history.current.length) {
      e.preventDefault();
      historyIndex.current = Math.min(historyIndex.current + 1, history.current.length - 1);
      setCommand(history.current[history.current.length - 1 - historyIndex.current]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      historyIndex.current = Math.max(historyIndex.current - 1, -1);
      setCommand(historyIndex.current < 0 ? "" : history.current[history.current.length - 1 - historyIndex.current]);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#141414]">
      <div ref={scroller} className="min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[12px] leading-[18px] text-[#c9c9c9]">
        {lines.length ? (
          lines.map((line, i) => (
            <div key={i} className={`whitespace-pre-wrap break-words ${line.startsWith("$ ") ? "text-white" : line.startsWith("✕") ? "text-red-400" : line.startsWith("✓") ? "text-emerald-400" : ""}`}>
              {line}
            </div>
          ))
        ) : (
          <div className="text-[#6b6b6b]">
            Terminal ready — commands run inside your project folder. Try <span className="text-[#9a9a9a]">npm install</span> then{" "}
            <span className="text-[#9a9a9a]">npm run dev</span>; the preview opens on localhost automatically.
          </div>
        )}
      </div>

      <div className="flex gap-1.5 overflow-x-auto border-t border-[#262626] px-3 py-1.5">
        {QUICK.map((q) => (
          <button
            key={q}
            type="button"
            disabled={busy}
            onClick={() => run(undefined, q)}
            className="shrink-0 rounded-md border border-[#2f2f2f] px-2 py-1 font-mono text-[11px] text-[#9a9a9a] transition-colors hover:bg-[#222] hover:text-white disabled:opacity-40"
          >
            {q}
          </button>
        ))}
      </div>

      <form onSubmit={run} className="flex items-center gap-2 border-t border-[#262626] px-3 py-2">
        <span className="font-mono text-xs text-emerald-400">$</span>
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Run a command…"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent font-mono text-[13px] text-white outline-none placeholder:text-[#555]"
        />
        <button type="submit" disabled={busy || !command.trim()} className="rounded-md bg-[#2a2a2a] px-3 py-1 text-xs text-white transition-colors hover:bg-[#333] disabled:opacity-40">
          {busy ? "Running…" : "Run"}
        </button>
      </form>
    </div>
  );
}