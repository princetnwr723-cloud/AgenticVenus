"use client";

// components/AgentTeamPanel.tsx
// Lives in the main chat panel. Shows which specialist agent the "boss
// agent" picked for the current task, and lets the user see the full team.

import { useState } from "react";
import { AGENT_TEAM, type Agent } from "@/lib/agents";

type Props = {
  activeAgent: Agent | null;
  classifying: boolean;
};

export default function AgentTeamPanel({ activeAgent, classifying }: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex items-center gap-2 rounded-md border border-ink/10 bg-white px-3 py-1.5 text-xs font-medium text-ink/80 transition-all hover:-translate-y-0.5 hover:shadow-sm"
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: activeAgent?.color ?? "#00000022" }}
        />
        {classifying
          ? "Choosing agent..."
          : activeAgent
          ? activeAgent.name
          : "Agent Team"}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="animate-scale-in absolute right-0 top-full z-20 mt-2 w-72 rounded-card border border-ink/10 bg-cream p-2 shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-ink/35">
            Agent team
          </p>
          {AGENT_TEAM.map((agent) => (
            <div
              key={agent.id}
              className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm ${
                activeAgent?.id === agent.id ? "bg-sand" : ""
              }`}
            >
              <span
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: agent.color }}
              />
              <div className="min-w-0">
                <p className="truncate text-ink">{agent.name}</p>
                <p className="truncate text-xs text-ink/45">{agent.description}</p>
              </div>
              {activeAgent?.id === agent.id && (
                <span className="ml-auto shrink-0 text-xs text-clay">Active</span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
