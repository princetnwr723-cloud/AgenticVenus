"use client";

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import type { ChatSummary } from "@/lib/chats";
import { listAgentConnections, createAgentConnection, deleteAgentConnection, type AgentConnection } from "@/lib/agentLinks";
import { createChatGroup } from "@/lib/chatGroups";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  currentChatId: string | null;
  chats: ChatSummary[];
  onGroupCreated: () => void;
};

export default function ConnectionsPanel({ uid, open, onClose, currentChatId, chats, onGroupCreated }: Props) {
  const [connections, setConnections] = useState<AgentConnection[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    setConnections(await listAgentConnections(uid));
    setLoading(false);
  }

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  function toggle(chatId: string) {
    setSelected((prev) => (prev.includes(chatId) ? prev.filter((c) => c !== chatId) : [...prev, chatId]));
  }

  async function handleCreateConnection() {
    if (!currentChatId || selected.length === 0) return;
    setBusy(true);
    await createAgentConnection(uid, currentChatId, selected);
    await refresh();
    setSelected([]);
    setBusy(false);
  }

  async function handleDeleteConnection(id: string) {
    await deleteAgentConnection(uid, id);
    await refresh();
  }

  async function handleCreateGroup() {
    if (!groupName.trim() || selected.length < 2) return;
    setBusy(true);
    await createChatGroup(uid, groupName.trim(), selected);
    setSelected([]);
    setGroupName("");
    setBusy(false);
    onGroupCreated();
    onClose();
  }

  const otherChats = chats.filter((c) => c.id !== currentChatId);
  const mine = connections.filter((c) => c.sourceChatId === currentChatId);

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Connections"
      subtitle="Let this chat's agent talk to other chats' agents — or merge chats into a Group."
    >
      {!currentChatId ? (
        <p className="text-sm text-ink/40">Send a message first so this chat is saved, then connect it to others.</p>
      ) : (
        <>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/35">Select chats</p>
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {otherChats.length === 0 ? (
              <p className="text-sm text-ink/40">No other chats yet.</p>
            ) : (
              otherChats.map((c) => (
                <label key={c.id} className="flex items-center gap-2.5 rounded-md border border-ink/10 bg-white px-3 py-2 text-sm">
                  <input type="checkbox" checked={selected.includes(c.id)} onChange={() => toggle(c.id)} />
                  <span className="truncate">{c.title}</span>
                </label>
              ))
            )}
          </div>

          <button
            onClick={handleCreateConnection}
            disabled={selected.length === 0 || busy}
            className="focus-ring mt-3 w-full rounded-md bg-clay px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark disabled:opacity-50"
          >
            Connect this agent to selected chats
          </button>

          <div className="mt-4 border-t border-ink/10 pt-4">
            <input
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Group name"
              className="focus-ring mb-2 w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
            />
            <button
              onClick={handleCreateGroup}
              disabled={!groupName.trim() || selected.length < 2 || busy}
              className="focus-ring w-full rounded-md border border-dashed border-ink/20 px-4 py-2.5 text-sm font-medium text-ink/60 transition-all hover:border-clay/40 hover:bg-sand hover:text-ink disabled:opacity-50"
            >
              + Create group from selected chats
            </button>
            <p className="mt-1.5 text-xs text-ink/40">Pick at least 2 chats above. They'll move out of Chats and into a new Group.</p>
          </div>
        </>
      )}

      <div className="mt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/35">This chat's connections</p>
        {loading ? (
          <p className="text-sm text-ink/50">Loading...</p>
        ) : mine.length === 0 ? (
          <p className="text-sm text-ink/40">No connections yet.</p>
        ) : (
          <ul className="space-y-2">
            {mine.map((c) => (
              <li key={c.id} className="flex items-center justify-between rounded-md border border-ink/10 bg-white px-3 py-2.5">
                <span className="text-sm text-ink">{c.targetChatIds.length} connected chat(s)</span>
                <button onClick={() => handleDeleteConnection(c.id)} className="text-xs text-ink/40 hover:text-red-600">
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SlideOverPanel>
  );
}