"use client";

import type { Mission, WorkerType } from "@/lib/missions";

const STATUS_ICON: Record<string, string> = { pending: "○", running: "◐", done: "✓", failed: "✕", skipped: "—" };
const WORKER_ICON: Record<WorkerType, string> = {
  planner: "🧭", researcher: "🔎", browser: "🌐", computer: "🖥️", coder: "💻",
  data: "📊", file: "📁", qa: "✅", writer: "✍️", security: "🛡️",
};

export default function MissionCard({ mission, onCancel }: { mission: Mission; onCancel?: () => void }) {
  const done = mission.subtasks.filter((s) => s.status === "done").length;
  return (
    <div className="animate-fade-in-up rounded-card border border-clay/25 bg-clay/5 px-4 py-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">🎯 {mission.objective}</p>
        <span className="text-xs text-ink/40">{done}/{mission.subtasks.length}</span>
      </div>
      <ul className="mt-2 space-y-1">
        {mission.subtasks.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-sm">
            <span className={s.status === "done" ? "text-moss" : s.status === "failed" ? "text-red-600" : s.status === "running" ? "text-clay animate-pulse" : "text-ink/30"}>
              {STATUS_ICON[s.status]}
            </span>
            <span className="text-xs">{WORKER_ICON[s.workerType]}</span>
            <span className={s.status === "failed" ? "text-red-700" : s.status === "skipped" ? "text-ink/35 line-through" : "text-ink/75"}>
              {s.description}
            </span>
          </li>
        ))}
      </ul>
      {mission.status === "running" && onCancel && (
        <button onClick={onCancel} className="mt-2 text-xs text-ink/40 hover:text-red-600">Cancel mission</button>
      )}
      {mission.summary && <p className="mt-2 text-sm text-ink/75">{mission.summary}</p>}
    </div>
  );
}