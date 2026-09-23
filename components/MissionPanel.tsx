"use client";

// components/MissionPanel.tsx
// Self-contained: a textarea for the big goal, a "Start mission" button that
// plans a small team's task graph and runs it, and a live view of every
// task's status. Deliberately its own panel rather than hijacking the main
// chat input, so it's an explicit mode rather than something that silently
// intercepts normal messages.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { auth } from "@/lib/firebase";
import { planMission } from "@/lib/mission/planner";
import { createMission, listMissions, getMission } from "@/lib/mission/store";
import { runMission } from "@/lib/missionRunner";
import type { Mission, MissionTask } from "@/lib/mission/types";
import type { SavedConnection } from "@/lib/connections";
import { listConnectedPluginIds } from "@/lib/pluginConnections";
import { getIntegrationKeys } from "@/lib/integrationKeys";
import { callPluginAction } from "@/lib/pluginOrchestrator";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  activeConnection: SavedConnection | null;
  currentChatId: string | null;
};

const ROLE_LABEL: Record<string, string> = {
  research: "🔎 Research",
  build: "🛠️ Build",
  leadgen: "🎯 Lead gen",
  outreach: "✉️ Outreach",
  watcher: "👀 Watching",
  report: "📋 Report",
  generic: "🤖 Task",
};

export default function MissionPanel({ uid, open, onClose, activeConnection, currentChatId }: Props) {
  const [goal, setGoal] = useState("");
  const [planning, setPlanning] = useState(false);
  const [missions, setMissions] = useState<Mission[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attachToChat, setAttachToChat] = useState(true);
  const [checkingNow, setCheckingNow] = useState(false);

  const active = missions.find((m) => m.id === activeId) || null;

  async function refresh() {
    const list = await listMissions(uid);
    setMissions(list);
    if (!activeId && list[0]) setActiveId(list[0].id);
  }

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open || !activeId) return;
    const interval = window.setInterval(async () => {
      const m = await getMission(uid, activeId);
      if (m) setMissions((prev) => [m, ...prev.filter((x) => x.id !== m.id)]);
    }, 3000);
    return () => window.clearInterval(interval);
  }, [open, activeId, uid]);

  async function handleStart() {
    if (!goal.trim() || !activeConnection) return;
    setPlanning(true);
    setError(null);
    try {
      const [toolIds, intKeys] = await Promise.all([listConnectedPluginIds(uid), getIntegrationKeys(uid)]);
      const tasks = await planMission(activeConnection.provider.id, activeConnection.apiKey, goal.trim(), activeConnection.model);
      const missionId = await createMission(uid, goal.trim(), tasks, attachToChat ? currentChatId || undefined : undefined);
      setGoal("");
      await refresh();
      setActiveId(missionId);

      const deps = {
        uid,
        providerId: activeConnection.provider.id,
        apiKey: activeConnection.apiKey,
        model: activeConnection.model,
        hasBrowser: !!intKeys.browserlessApiKey,
        hasDaytona: !!intKeys.daytonaApiKey,
        gmailConnected: toolIds.includes("gmail"),
        calendarConnected: toolIds.includes("google-calendar"),
      };
      runMission(deps, missionId, { onUpdate: (m) => setMissions((prev) => [m, ...prev.filter((x) => x.id !== m.id)]) });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't plan that mission.");
    } finally {
      setPlanning(false);
    }
  }

  async function handleReviewDrafts() {
    setError(null);
    try {
      const list = await callPluginAction("gmail", "gmail.list_messages", { query: "in:drafts" });
      setError(`Open Gmail's Drafts folder to review and send — nothing is bulk-sent automatically.\n\n${list.slice(0, 500)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check drafts.");
    }
  }

  async function handleCheckNow() {
    setCheckingNow(true);
    setError(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/missions/tick", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Check failed.");
      setError(`Checked — ${data.tasksProcessed} due item(s) processed.`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't check right now.");
    } finally {
      setCheckingNow(false);
    }
  }

  const hasWatcher = active?.tasks.some((t) => t.role === "watcher");
  const hasOutreachDone = active?.tasks.some((t) => t.role === "outreach" && t.status === "done");

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Missions"
      subtitle="Give it a big, multi-part goal — a team of specialist agents plans it, splits the independent parts to run in parallel, and reports back."
    >
      <div className="space-y-2">
        <textarea
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          placeholder={'e.g. "Build a 3D car showcase website, find leads to sell it to, email them, and book a call whenever someone replies interested — then tell me."'}
          rows={4}
          className="focus-ring w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <label className="flex items-center gap-2 text-xs text-ink/60">
          <input type="checkbox" checked={attachToChat} onChange={(e) => setAttachToChat(e.target.checked)} disabled={!currentChatId} />
          Post the final report into this chat when it&apos;s done{!currentChatId ? " (send a chat message first)" : ""}
        </label>
        <button
          onClick={handleStart}
          disabled={!goal.trim() || planning || !activeConnection}
          className="focus-ring w-full rounded-md bg-clay px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark disabled:opacity-50"
        >
          {planning ? "Planning the team…" : "Start mission"}
        </button>
        {error && <p className="whitespace-pre-wrap text-xs text-ink/70">{error}</p>}
      </div>

      {missions.length > 0 && (
        <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
          {missions.map((m) => (
            <button
              key={m.id}
              onClick={() => setActiveId(m.id)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${m.id === activeId ? "border-clay bg-clay/10 text-clay" : "border-ink/10 text-ink/60 hover:bg-sand"}`}
            >
              {m.status === "running" ? "⏳" : m.status === "done" ? "✅" : m.status === "failed" ? "⚠️" : "•"} {m.goal.slice(0, 28)}
            </button>
          ))}
        </div>
      )}

      {active && (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium text-ink">{active.goal}</p>
          {active.tasks.map((t) => (
            <TaskRow key={t.id} task={t} />
          ))}
          <div className="mt-2 flex gap-2">
            {hasOutreachDone && (
              <button onClick={handleReviewDrafts} className="flex-1 rounded-md border border-clay/30 bg-clay/5 px-3 py-2 text-xs font-medium text-clay hover:bg-clay/10">
                Review drafts before sending
              </button>
            )}
            {hasWatcher && (
              <button onClick={handleCheckNow} disabled={checkingNow} className="flex-1 rounded-md border border-ink/10 px-3 py-2 text-xs font-medium text-ink/60 hover:bg-sand disabled:opacity-50">
                {checkingNow ? "Checking…" : "Check for replies now"}
              </button>
            )}
          </div>
        </div>
      )}
    </SlideOverPanel>
  );
}

function TaskRow({ task }: { task: MissionTask }) {
  const color =
    task.status === "done"
      ? "border-moss/30 bg-moss/5"
      : task.status === "failed"
      ? "border-red-200 bg-red-50"
      : task.status === "running"
      ? "border-clay/30 bg-clay/5 animate-pulse"
      : "border-ink/10 bg-white";
  return (
    <div className={`rounded-md border px-3 py-2.5 text-sm ${color}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ink">
          {ROLE_LABEL[task.role] || task.role} — {task.title}
        </span>
        <span className="shrink-0 text-[11px] uppercase tracking-wide text-ink/40">{task.status}</span>
      </div>
      {task.result && (
        <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink/65">
          {task.result.slice(0, 600)}
          {task.result.length > 600 ? "…" : ""}
        </p>
      )}
      {task.error && <p className="mt-1.5 text-xs text-red-600">{task.error}</p>}
    </div>
  );
}