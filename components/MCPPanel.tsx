"use client";

// components/MCPPanel.tsx
// Lets the user register MCP servers the agent should eventually be able
// to call tools through. Stores config only for now (see lib/mcp.ts).

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { addMCPServer, deleteMCPServer, listMCPServers, type MCPServer } from "@/lib/mcp";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
};

export default function MCPPanel({ uid, open, onClose }: Props) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  async function refresh() {
    setLoading(true);
    setServers(await listMCPServers(uid));
    setLoading(false);
  }

  useEffect(() => {
    if (open) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function handleAdd() {
    if (!name.trim() || !url.trim()) return;
    setSubmitting(true);
    await addMCPServer(uid, name.trim(), url.trim());
    setName("");
    setUrl("");
    await refresh();
    setSubmitting(false);
  }

  async function handleDelete(id: string) {
    await deleteMCPServer(uid, id);
    await refresh();
  }

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="MCP Tools"
      subtitle="Give your agent access to your own tools through MCP servers."
    >
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Server name (e.g. My Filesystem Tools)"
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Server URL"
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={!name.trim() || !url.trim() || submitting}
          className="focus-ring w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
        >
          {submitting ? "Saving..." : "Add MCP server"}
        </button>
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/35">
          Connected servers
        </p>
        {loading ? (
          <p className="text-sm text-ink/50">Loading...</p>
        ) : servers.length === 0 ? (
          <p className="text-sm text-ink/40">No MCP servers added yet.</p>
        ) : (
          <ul className="space-y-2">
            {servers.map((s) => (
              <li
                key={s.id}
                className="animate-fade-in-up flex items-center justify-between rounded-md border border-ink/10 bg-white px-3 py-2.5"
              >
                <div>
                  <p className="text-sm font-medium text-ink">{s.name}</p>
                  <p className="text-xs text-ink/50">{s.url}</p>
                </div>
                <button
                  onClick={() => handleDelete(s.id)}
                  className="text-xs text-ink/40 hover:text-red-600"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-6 text-xs text-ink/40">
        Saved for now — actually calling tools through these servers needs a
        small server-side MCP client, since most MCP servers can't be
        reached with a plain browser request. That's the next wiring step.
      </p>
    </SlideOverPanel>
  );
}
