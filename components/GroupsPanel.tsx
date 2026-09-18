"use client";

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { AGENT_TEAM } from "@/lib/agents";
import {
  listAgentGroups,
  createAgentGroup,
  updateAgentGroup,
  deleteAgentGroup,
  type AgentGroup,
} from "@/lib/agentGroups";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  onGroupsChange?: (groups: AgentGroup[]) => void;
};

export default function GroupsPanel({ uid, open, onClose, onGroupsChange }: Props) {
  const [groups, setGroups] = useState<AgentGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState("");
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function refresh() {
    setLoading(true);
    const list = await listAgentGroups(uid);
    setGroups(list);
    onGroupsChange?.(list);
    setLoading(false);
  }

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggleAgent(id: string) {
    setSelectedAgentIds((prev) => (prev.includes(id) ? prev.filter((a) => a !== id) : [...prev, id]));
  }

  function startEdit(group: AgentGroup) {
    setEditingId(group.id);
    setName(group.name);
    setSelectedAgentIds(group.agentIds);
  }

  function resetForm() {
    setEditingId(null);
    setName("");
    setSelectedAgentIds([]);
  }

  async function handleSave() {
    if (!name.trim() || selectedAgentIds.length < 2) return;
    setSaving(true);
    if (editingId) {
      await updateAgentGroup(uid, editingId, name.trim(), selectedAgentIds);
    } else {
      await createAgentGroup(uid, name.trim(), selectedAgentIds);
    }
    resetForm();
    await refresh();
    setSaving(false);
  }

  async function handleDelete(id: string) {
    await deleteAgentGroup(uid, id);
    if (editingId === id) resetForm();
    await refresh();
  }

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Agent Groups"
      subtitle="Put two or more specialists on the same task — each contributes, then the team's work is combined into one answer."
    >
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Group name (e.g. Launch Team)"
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <div className="space-y-1.5">
          {AGENT_TEAM.map((agent) => (
            <label key={agent.id} className="flex items-center gap-2.5 rounded-md border border-ink/10 bg-white px-3 py-2 text-sm">
              <input type="checkbox" checked={selectedAgentIds.includes(agent.id)} onChange={() => toggleAgent(agent.id)} />
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: agent.color }} />
              {agent.name}
            </label>
          ))}
        </div>
        <p className="text-xs text-ink/40">Pick at least 2 agents. They'll contribute in this order.</p>
        <div className="flex gap-2">
          <button
            onClick={handleSave}
            disabled={!name.trim() || selectedAgentIds.length < 2 || saving}
            className="focus-ring flex-1 rounded-md bg-clay px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark disabled:opacity-50"
          >
            {saving ? "Saving..." : editingId ? "Update group" : "Create group"}
          </button>
          {editingId && (
            <button onClick={resetForm} className="rounded-md border border-ink/15 px-4 py-2.5 text-sm text-ink/60 hover:bg-sand">
              Cancel
            </button>
          )}
        </div>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/35">Your groups</p>
        {loading ? (
          <p className="text-sm text-ink/50">Loading...</p>
        ) : groups.length === 0 ? (
          <p className="text-sm text-ink/40">No groups yet — create one above.</p>
        ) : (
          <ul className="space-y-2">
            {groups.map((g) => (
              <li key={g.id} className="rounded-md border border-ink/10 bg-white px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-ink">{g.name}</p>
                  <div className="flex gap-2">
                    <button onClick={() => startEdit(g)} className="text-xs text-ink/40 hover:text-ink">Edit</button>
                    <button onClick={() => handleDelete(g.id)} className="text-xs text-ink/40 hover:text-red-600">Delete</button>
                  </div>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {g.agentIds.map((id) => {
                    const agent = AGENT_TEAM.find((a) => a.id === id);
                    if (!agent) return null;
                    return (
                      <span key={id} className="flex items-center gap-1 rounded-full bg-sand px-2 py-0.5 text-[11px] text-ink/70">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: agent.color }} />
                        {agent.name}
                      </span>
                    );
                  })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SlideOverPanel>
  );
}