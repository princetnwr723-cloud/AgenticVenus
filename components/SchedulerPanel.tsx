"use client";

// components/SchedulerPanel.tsx
// Schedule a message to be run against the connected agent at a future
// time. Due tasks are executed when the workspace is open (see
// lib/scheduler.ts for the background-execution caveat).

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import {
  addScheduledTask,
  deleteScheduledTask,
  listScheduledTasks,
  type ScheduledTask,
} from "@/lib/scheduler";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  hasConnection: boolean;
};

export default function SchedulerPanel({ uid, open, onClose, hasConnection }: Props) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [message, setMessage] = useState("");
  const [when, setWhen] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    setTasks(await listScheduledTasks(uid));
    setLoading(false);
  }

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleAdd() {
    if (!message.trim() || !when) return;
    setSubmitting(true);
    await addScheduledTask(uid, message.trim(), new Date(when));
    setMessage("");
    setWhen("");
    await refresh();
    setSubmitting(false);
  }

  async function handleDelete(id: string) {
    await deleteScheduledTask(uid, id);
    await refresh();
  }

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Scheduler"
      subtitle="Queue a message for your agent to answer later."
    >
      {!hasConnection && (
        <p className="mb-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Connect a provider first so scheduled tasks have an agent to run
          against.
        </p>
      )}

      <div className="space-y-3">
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="What should the agent do?"
          rows={2}
          className="focus-ring w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <input
          type="datetime-local"
          value={when}
          onChange={(e) => setWhen(e.target.value)}
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={!message.trim() || !when || submitting}
          className="focus-ring w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
        >
          {submitting ? "Scheduling..." : "Schedule"}
        </button>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/35">
          Upcoming & recent
        </p>
        {loading ? (
          <p className="text-sm text-ink/50">Loading...</p>
        ) : tasks.length === 0 ? (
          <p className="text-sm text-ink/40">No scheduled tasks yet.</p>
        ) : (
          <ul className="space-y-2">
            {tasks.map((t) => (
              <li
                key={t.id}
                className="animate-fade-in-up rounded-md border border-ink/10 bg-white px-3 py-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm text-ink">{t.message}</p>
                  <button
                    onClick={() => handleDelete(t.id)}
                    className="shrink-0 text-xs text-ink/40 hover:text-red-600"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-ink/45">
                  <span>{t.runAt.toDate().toLocaleString()}</span>
                  <StatusBadge status={t.status} />
                </div>
                {t.resultText && (
                  <p className="mt-2 whitespace-pre-wrap rounded-md bg-sand px-2.5 py-2 text-xs text-ink/75">
                    {t.resultText}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </SlideOverPanel>
  );
}

function StatusBadge({ status }: { status: ScheduledTask["status"] }) {
  const styles: Record<ScheduledTask["status"], string> = {
    pending: "bg-sand text-ink/60",
    done: "bg-moss/15 text-moss",
    failed: "bg-red-100 text-red-700",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}>
      {status}
    </span>
  );
}
