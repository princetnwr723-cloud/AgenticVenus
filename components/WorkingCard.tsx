"use client";

import { useEffect, useState } from "react";

type Props = { label?: string; agentName?: string | null; onStop?: () => void };

export default function WorkingCard({ label = "Working on it…", agentName, onStop }: Props) {
  const [startedAt] = useState(() => Date.now());
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setElapsed(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  return (
    <div className="animate-fade-in-up rounded-2xl border border-ink/10 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-3">
        <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-ink text-cream">
          <span className="h-2 w-2 animate-pulse rounded-full bg-moss" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm font-medium text-ink">{label}</p>
            <span className="font-mono text-xs tabular-nums text-ink/45">{mm}:{ss}</span>
          </div>
          <p className="mt-0.5 truncate text-xs text-ink/45">{agentName ? `${agentName} · ` : ""}Terminal · Browser · Tools · Verification</p>
        </div>
        {onStop && <button onClick={onStop} className="rounded-md border border-ink/10 px-2 py-1 text-[11px] text-ink/50 hover:bg-sand hover:text-ink">Stop</button>}
      </div>
    </div>
  );
}
