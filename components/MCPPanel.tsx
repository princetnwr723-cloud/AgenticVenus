"use client";

// components/MCPPanel.tsx
// Adding a server here actually connects to it (via /api/mcp/tools),
// discovers its real tools, and saves them — this is what makes MCP
// tools genuinely callable from chat afterwards (see
// lib/mcpOrchestrator.ts), instead of just remembering a URL.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { addMCPServer, deleteMCPServer, listMCPServers, type MCPServer } from "@/lib/mcp";
import { discoverMcpTools } from "@/lib/mcpOrchestrator";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
};

export default function MCPPanel({ uid, open, onClose }: Props) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [authHeader, setAuthHeader] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
    setError(null);
    try {
      const tools = await discoverMcpTools(url.trim(), authHeader.trim() || undefined);
      await addMCPServer(uid, name.trim(), url.trim(), authHeader.trim() || undefined, tools);
      setName("");
      setUrl("");
      setAuthHeader("");
      await refresh();
    } catch (err) {
      setError(
        err instanceof Error
          ? `Couldn't connect: ${err.message}`
          : "Couldn't connect to that MCP server."
      );
    } finally {
      setSubmitting(false);
    }
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
      subtitle="Connect a real MCP server so your agent can actually call its tools."
    >
      <div className="space-y-3">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Server name (e.g. Creatify)"
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="Server URL (https://...)"
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <input
          value={authHeader}
          onChange={(e) => setAuthHeader(e.target.value)}
          placeholder="Authorization header (optional, e.g. Bearer sk-...)"
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={!name.trim() || !url.trim() || submitting}
          className="focus-ring w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
        >
          {submitting ? "Connecting..." : "Connect MCP server"}
        </button>
        {error && <p className="text-xs text-red-600">{error}</p>}
        <p className="text-xs text-ink/40">
          Most hosted MCP servers (like Creatify's) need an API key in the
          Authorization header — check that service's MCP docs for the
          exact value to paste here.
        </p>
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
          <ul className="space-y-3">
            {servers.map((s) => (
              <li key={s.id} className="animate-fade-in-up rounded-md border border-ink/10 bg-white px-3 py-2.5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium text-ink">{s.name}</p>
                    <p className="text-xs text-ink/50">{s.url}</p>
                  </div>
                  <button onClick={() => handleDelete(s.id)} className="text-xs text-ink/40 hover:text-red-600">
                    Remove
                  </button>
                </div>
                {s.tools && s.tools.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.tools.map((t) => (
                      <span
                        key={t.name}
                        title={t.description}
                        className="rounded-full bg-sand px-2 py-0.5 text-[11px] text-ink/70"
                      >
                        {t.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-ink/35">No tools discovered on this server.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="mt-6 text-xs text-ink/40">
        Once connected, the agent can decide on its own to call one of
        these tools when your message needs it — you'll see the result
        woven into its reply.
      </p>
    </SlideOverPanel>
  );
}