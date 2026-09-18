"use client";

// components/AgentTeamPanel.tsx
// Lives in the main chat panel. Shows which specialist agent (or Group)
// is active for this chat, and lets the user switch between a single
// auto-picked specialist and any saved Group.

import { useState } from "react";
import { AGENT_TEAM, type Agent } from "@/lib/agents";
import type { AgentGroup } from "@/lib/agentGroups";

type Props = {
  activeAgent: Agent | null;
  classifying: boolean;
  groups: AgentGroup[];
  activeGroupId: string | null;
  onSelectGroup: (groupId: string | null) => void;
  onManageGroups: () => void;
};

export default function AgentTeamPanel({ activeAgent, classifying, groups, activeGroupId, onSelectGroup, onManageGroups }: Props) {
  const [open, setOpen] = useState(false);
  const activeGroup = groups.find((g) => g.id === activeGroupId) || null;

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex items-center gap-2 rounded-md border border-ink/10 bg-white px-3 py-1.5 text-xs font-medium text-ink/80 transition-all hover:-translate-y-0.5 hover:shadow-sm"
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: activeGroup ? "#BF5F3F" : activeAgent?.color ?? "#00000022" }}
        />
        {classifying
          ? "Choosing agent..."
          : activeGroup
          ? `Group: ${activeGroup.name}`
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
          <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-ink/35">Agent team</p>
          <button
            onClick={() => onSelectGroup(null)}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${!activeGroupId ? "bg-sand" : ""}`}
          >
            Auto (single specialist)
          </button>
          {AGENT_TEAM.map((agent) => (
            <div
              key={agent.id}
              className={`flex items-center gap-2 rounded-md px-2 py-2 text-sm ${
                !activeGroupId && activeAgent?.id === agent.id ? "bg-sand" : ""
              }`}
            >
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: agent.color }} />
              <div className="min-w-0">
                <p className="truncate text-ink">{agent.name}</p>
                <p className="truncate text-xs text-ink/45">{agent.description}</p>
              </div>
              {!activeGroupId && activeAgent?.id === agent.id && (
                <span className="ml-auto shrink-0 text-xs text-clay">Active</span>
              )}
            </div>
          ))}

          {groups.length > 0 && (
            <>
              <p className="mt-2 px-2 py-1 text-xs font-medium uppercase tracking-wide text-ink/35">Groups</p>
              {groups.map((g) => (
                <button
                  key={g.id}
                  onClick={() => onSelectGroup(g.id)}
                  className={`flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm ${
                    activeGroupId === g.id ? "bg-sand" : ""
                  }`}
                >
                  <span className="truncate text-ink">{g.name}</span>
                  {activeGroupId === g.id && <span className="shrink-0 text-xs text-clay">Active</span>}
                </button>
              ))}
            </>
          )}

          <button
            onClick={onManageGroups}
            className="mt-2 w-full rounded-md border border-dashed border-ink/20 px-2 py-2 text-left text-xs text-ink/50 hover:bg-sand hover:text-ink"
          >
            + Manage groups
          </button>
        </div>
      )}
    </div>
  );
}