"use client";

// components/BrowserViewPanel.tsx
// Same structure as ComputerViewPanel, but for a real remote Chrome via
// Browserless — live view + a task box that runs the browser agent loop
// (see lib/browserClient.ts's runBrowserTask). Browserless's live-session
// URL is embed-friendly on its own, so unlike Computer Use this doesn't
// need a proxy route — it's just dropped straight into the iframe src.

import { useState } from "react";

type Props = {
  open: boolean;
  onClose: () => void;
  liveUrl: string | null;
  starting: boolean;
  onStart: () => void;
  onStop: () => void;
  stepLog: string[];
  onRunTask?: (task: string) => void;
  running?: boolean;
};

export default function BrowserViewPanel({
  open,
  onClose,
  liveUrl,
  starting,
  onStart,
  onStop,
  stepLog,
  onRunTask,
  running,
}: Props) {
  const [taskInput, setTaskInput] = useState("");
  if (!open) return null;

  return (
    <div className="animate-fade-in fixed inset-0 z-40 flex justify-end bg-ink/30" onClick={onClose}>
      <div className="animate-scale-in flex h-full w-full max-w-2xl flex-col bg-[#1e1c19] text-cream shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-white/10 px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-moss" />
            <h2 className="text-sm font-medium">Browser — live view</h2>
          </div>
          <div className="flex items-center gap-2">
            {liveUrl ? (
              <button onClick={onStop} className="rounded-md border border-white/15 px-2.5 py-1 text-xs text-cream/70 hover:bg-white/10 hover:text-cream">
                Stop browser
              </button>
            ) : (
              <button
                onClick={onStart}
                disabled={starting}
                className="rounded-md bg-moss px-2.5 py-1 text-xs font-medium text-cream hover:bg-moss/80 disabled:opacity-50"
              >
                {starting ? "Starting browser..." : "Start browser"}
              </button>
            )}
            <button onClick={onClose} aria-label="Close" className="rounded-md p-1 text-cream/60 hover:text-cream">
              ✕
            </button>
          </div>
        </div>

        {liveUrl ? (
          <iframe title="Browser live view" src={liveUrl} className="h-full w-full flex-1 border-0 bg-white" />
        ) : (
          <div className="flex flex-1 items-center justify-center px-8 text-center text-sm text-cream/40">
            {starting
              ? "Connecting to Browserless..."
              : "Start a browser session to give the agent real web access."}
          </div>
        )}

        {liveUrl && onRunTask && (
          <div className="flex items-center gap-2 border-t border-white/10 px-4 py-3">
            <input
              value={taskInput}
              onChange={(e) => setTaskInput(e.target.value)}
              placeholder="Tell the agent what to do on the web..."
              className="flex-1 rounded-md border border-white/15 bg-[#2a2723] px-3 py-2 text-sm text-cream outline-none placeholder:text-cream/30"
            />
            <button
              onClick={() => {
                if (taskInput.trim()) {
                  onRunTask(taskInput.trim());
                  setTaskInput("");
                }
              }}
              disabled={!taskInput.trim() || running}
              className="rounded-md bg-moss px-3 py-2 text-sm font-medium text-cream hover:bg-moss/80 disabled:opacity-50"
            >
              {running ? "Working..." : "Go"}
            </button>
          </div>
        )}

        {stepLog.length > 0 && (
          <div className="max-h-32 overflow-y-auto border-t border-white/10 px-4 py-2">
            {stepLog.map((s, i) => (
              <p key={i} className="text-[11px] text-cream/50">
                {s}
              </p>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}