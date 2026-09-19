"use client";

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { listMissions, deleteMission, type Mission } from "@/lib/missions";

const STATUS_LABEL: Record<string, string> = {
  running: "Running", waiting_for_user: "Waiting on you", recovering: "Recovering",
  verifying: "Verifying", completed: "Completed", failed: "Failed", cancelled: "Cancelled",
};

type Props = { uid: string; open: boolean; onClose: () => void; onResume: (mission: Mission) => void };

export default function MissionsPanel({ uid, open, onClose, onResume }: Props) {
  const [missions, setMissions] = useState<Mission[]>([]);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setMissions(await listMissions(uid));
    setLoading(false);
  }

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleDelete(id: string) {
    await deleteMission(uid, id);
    await refresh();
  }

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Missions" subtitle="Multi-step objectives the agent is tracking — resumable anytime.">
      {loading ? (
        <p className="text-sm text-ink/50">Loading...</p>
      ) : missions.length === 0 ? (
        <p className="text-sm text-ink/40">No missions yet — a big multi-step request will show up here.</p>
      ) : (
        <ul className="space-y-3">
          {missions.map((m) => {
            const done = m.subtasks.filter((s) => s.status === "done").length;
            return (
              <li key={m.id} className="rounded-md border border-ink/10 bg-white px-3 py-2.5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-ink">{m.objective}</p>
                  <button onClick={() => handleDelete(m.id)} className="shrink-0 text-xs text-ink/40 hover:text-red-600">Delete</button>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-ink/45">
                  <span>{STATUS_LABEL[m.status] || m.status}</span>
                  <span>· {done}/{m.subtasks.length} steps</span>
                </div>
                {(m.status === "running" || m.status === "failed" || m.status === "waiting_for_user") && (
                  <button onClick={() => onResume(m)} className="mt-2 rounded-md bg-clay px-3 py-1.5 text-xs font-medium text-cream hover:bg-clay-dark">
                    Resume
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </SlideOverPanel>
  );
}