"use client";

// components/MissionFlowPanel.tsx
// Replaces the old sidebar "Missions" panel. This is now per-chat: opened
// from a header button next to Settings, it shows THIS chat's mission as a
// layered flow — one column per dependency stage, each box showing which
// specialist is on it and, right under the box, what it's actually doing or
// found. Missions are no longer started from a form here — the agent
// decides on its own, from a normal chat message, whether a task needs a
// small team (see lib/mission/classifier.ts) and starts one automatically.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { auth } from "@/lib/firebase";
import { listMissions, getMission } from "@/lib/mission/store";
import type { Mission, MissionTask } from "@/lib/mission/types";
import { callPluginAction } from "@/lib/pluginOrchestrator";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  chatId: string | null;
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

function layerTasks(tasks: MissionTask[]): MissionTask[][] {
  const layers: MissionTask[][] = [];
  const placed = new Set<string>();
  let remaining = [...tasks];
  let guard = 0;
  while (remaining.length && guard++ < 12) {
    const layer = remaining.filter((t) => t.dependsOn.every((d) => placed.has(d)));
    if (!layer.length) {
      layers.push(remaining); // dependency we couldn't resolve — show the rest together rather than loop forever
      break;
    }
    layers.push(layer);
    layer.forEach((t) => placed.add(t.id));
    remaining = remaining.filter((t) => !layer.includes(t));
  }
  return layers;
}

export default function MissionFlowPanel({ uid, open, onClose, chatId }: Props) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [checkingNow, setCheckingNow] = useState(false);

  const chatMissions = missions.filter((m) => m.chatId === chatId);
  const active = chatMissions.find((m) => m.id === activeId) || chatMissions[0] || null;

  async function refresh() {
    const list = await listMissions(uid);
    setMissions(list);
  }

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, chatId]);

  useEffect(() => {
    if (!open || !active) return;
    const interval = window.setInterval(async () => {
      const m = await getMission(uid, active.id);
      if (m) setMissions((prev) => [m, ...prev.filter((x) => x.id !== m.id)]);
    }, 2500);
    return () => window.clearInterval(interval);
  }, [open, active?.id, uid]);

  async function handleReviewDrafts() {
    setNote(null);
    try {
      const list = await callPluginAction("gmail", "gmail.list_messages", { query: "in:drafts" });
      setNote(`Open Gmail's Drafts folder to review and send — nothing is bulk-sent automatically.\n\n${list.slice(0, 400)}`);
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't check drafts.");
    }
  }

  async function handleCheckNow() {
    setCheckingNow(true);
    setNote(null);
    try {
      const token = await auth.currentUser?.getIdToken();
      const res = await fetch("/api/missions/tick", { method: "POST", headers: { authorization: `Bearer ${token}` } });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Check failed.");
      setNote(`Checked — ${data.tasksProcessed} due item(s) processed.`);
      await refresh();
    } catch (err) {
      setNote(err instanceof Error ? err.message : "Couldn't check right now.");
    } finally {
      setCheckingNow(false);
    }
  }

  const layers = active ? layerTasks(active.tasks) : [];
  const hasWatcher = active?.tasks.some((t) => t.role === "watcher");
  const hasOutreachDone = active?.tasks.some((t) => t.role === "outreach" && t.status === "done");

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Agent Team"
      subtitle="When a message needs more than one specialist, the team plans and works here — this chat's own team only."
    >
      {chatMissions.length === 0 ? (
        <p className="text-sm text-ink/45">
          Nothing yet in this chat. Ask for something with a few independent parts — e.g. "build a site and find leads to sell it to, then
          email them" — and the team will appear here automatically.
        </p>
      ) : (
        <>
          {chatMissions.length > 1 && (
            <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
              {chatMissions.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setActiveId(m.id)}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs ${
                    (active?.id || chatMissions[0].id) === m.id ? "border-clay bg-clay/10 text-clay" : "border-ink/10 text-ink/60 hover:bg-sand"
                  }`}
                >
                  {m.status === "running" ? "⏳" : m.status === "done" ? "✅" : m.status === "failed" ? "⚠️" : "•"} {m.goal.slice(0, 24)}
                </button>
              ))}
            </div>
          )}

          {active && (
            <>
              <p className="mb-4 text-sm font-medium text-ink">{active.goal}</p>

              <div className="flex gap-3 overflow-x-auto pb-2">
                {layers.map((layer, i) => (
                  <div key={i} className="flex min-w-[190px] flex-1 flex-col gap-3">
                    <p className="text-center text-[10px] font-medium uppercase tracking-wide text-ink/35">Stage {i + 1}</p>
                    {layer.map((task) => (
                      <FlowBox key={task.id} task={task} />
                    ))}
                    {i < layers.length - 1 && <div className="flex justify-center text-ink/25">↓</div>}
                  </div>
                ))}
              </div>

              <div className="mt-4 flex gap-2">
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
              {note && <p className="mt-3 whitespace-pre-wrap rounded-md bg-sand/60 px-3 py-2 text-xs text-ink/70">{note}</p>}
            </>
          )}
        </>
      )}
    </SlideOverPanel>
  );
}

function FlowBox({ task }: { task: MissionTask }) {
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
        <span className="font-medium text-ink">{ROLE_LABEL[task.role] || task.role}</span>
        <span className="shrink-0 text-[10px] uppercase tracking-wide text-ink/40">{task.status}</span>
      </div>
      <p className="mt-0.5 text-xs text-ink/70">{task.title}</p>
      {/* "under each section" — what this specific agent is doing / found, live */}
      {task.result && (
        <p className="mt-1.5 whitespace-pre-wrap border-t border-ink/10 pt-1.5 text-[11px] text-ink/55">
          {task.result.slice(0, 300)}
          {task.result.length > 300 ? "…" : ""}
        </p>
      )}
      {task.error && <p className="mt-1.5 border-t border-red-100 pt-1.5 text-[11px] text-red-600">{task.error}</p>}
    </div>
  );
}