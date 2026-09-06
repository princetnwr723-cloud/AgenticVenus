"use client";

// components/MCPPanel.tsx
// Adding a server here now works like Claude.ai: type the URL, and
// AgenticVenus checks what auth it needs. If it supports OAuth, a
// "Continue to X" button appears — click it, log in on that service, and
// you're connected, no key to find or paste. If it just needs a static
// API key, the field for that appears instead. If it needs nothing, it
// connects immediately.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { addMCPServer, deleteMCPServer, listMCPServers, type MCPServer } from "@/lib/mcp";
import { probeMcpServer, startMcpOAuth, discoverMcpTools, type ProbeResult } from "@/lib/mcpOrchestrator";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  prefill?: { name: string; url: string } | null;
};

export default function MCPPanel({ uid, open, onClose, prefill }: Props) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [apiKeyHeader, setApiKeyHeader] = useState("");
  const [probe, setProbe] = useState<ProbeResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedList, setLoadedList] = useState(false);

  useEffect(() => {
    if (open && prefill) {
      setName(prefill.name);
      setUrl(prefill.url);
      setProbe(null);
      // Auto-check right away so the user lands straight on the OAuth/API key step.
      probeMcpServer(prefill.url)
        .then(setProbe)
        .catch(() => setProbe({ authType: "apikey" }));
    }
  }, [open, prefill]);

  async function refresh() {
    setServers(await listMCPServers(uid));
    setLoadedList(true);
  }

  if (open && !loadedList) refresh();

  function resetForm() {
    setName("");
    setUrl("");
    setApiKeyHeader("");
    setProbe(null);
    setError(null);
  }

  async function handleCheck() {
    if (!name.trim() || !url.trim()) return;
    setChecking(true);
    setError(null);
    try {
      const result = await probeMcpServer(url.trim());
      setProbe(result);
    } catch {
      setProbe({ authType: "apikey" });
    } finally {
      setChecking(false);
    }
  }

  async function handleContinueOAuth() {
    setSubmitting(true);
    setError(null);
    try {
      const authUrl = await startMcpOAuth(name.trim(), url.trim());
      window.location.href = authUrl; // full redirect — OAuth needs top-level navigation
    } catch (err) {
      setError(
        (err instanceof Error ? err.message : "Failed to start login.") +
          " You can try an API key or token instead below."
      );
      setProbe({ authType: "apikey" });
      setSubmitting(false);
    }
  }

  async function handleConnectDirect() {
    setSubmitting(true);
    setError(null);
    try {
      const tools = await discoverMcpTools(url.trim(), apiKeyHeader.trim() || undefined);
      await addMCPServer(
        uid,
        name.trim(),
        url.trim(),
        probe?.authType === "apikey" ? "apikey" : "none",
        apiKeyHeader.trim() || undefined,
        tools
      );
      resetForm();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? `Couldn't connect: ${err.message}` : "Couldn't connect to that server.");
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
          onChange={(e) => {
            setName(e.target.value);
            setProbe(null);
          }}
          placeholder="Server name (e.g. Creatify, Gmail)"
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
        <input
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            setProbe(null);
          }}
          placeholder="Server URL (https://...)"
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />

        {!probe && (
          <button
            onClick={handleCheck}
            disabled={!name.trim() || !url.trim() || checking}
            className="focus-ring w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
          >
            {checking ? "Checking..." : "Continue"}
          </button>
        )}

        {probe?.authType === "oauth" && (
          <>
            <button
              onClick={handleContinueOAuth}
              disabled={submitting}
              className="focus-ring w-full rounded-md bg-clay px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark disabled:opacity-50"
            >
              {submitting ? "Redirecting..." : `Continue to ${name.trim()}`}
            </button>
            <button
              onClick={() => setProbe({ authType: "apikey" })}
              className="w-full text-center text-xs text-ink/40 hover:text-ink"
            >
              Or use an API key / token instead
            </button>
          </>
        )}

        {probe?.authType === "apikey" && (
          <>
            <input
              value={apiKeyHeader}
              onChange={(e) => setApiKeyHeader(e.target.value)}
              placeholder="Authorization header (e.g. Bearer sk-...)"
              className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
            />
            <button
              onClick={handleConnectDirect}
              disabled={submitting}
              className="focus-ring w-full rounded-md bg-clay px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark disabled:opacity-50"
            >
              {submitting ? "Connecting..." : "Connect"}
            </button>
          </>
        )}

        {probe?.authType === "none" && (
          <button
            onClick={handleConnectDirect}
            disabled={submitting}
            className="focus-ring w-full rounded-md bg-clay px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark disabled:opacity-50"
          >
            {submitting ? "Connecting..." : "Connect (no login needed)"}
          </button>
        )}

        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>

      <div className="mt-6">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink/35">
          Connected servers
        </p>
        {servers.length === 0 ? (
          <p className="text-sm text-ink/40">No MCP servers added yet.</p>
        ) : (
          <ul className="space-y-3">
            {servers.map((s) => (
              <li key={s.id} className="animate-fade-in-up rounded-md border border-ink/10 bg-white px-3 py-2.5">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="flex items-center gap-2 text-sm font-medium text-ink">
                      {s.name}
                      <span className="rounded-full bg-sand px-2 py-0.5 text-[10px] font-medium text-ink/50">
                        {s.authType === "oauth" ? "OAuth" : s.authType === "apikey" ? "API key" : "Open"}
                      </span>
                    </p>
                    <p className="text-xs text-ink/50">{s.url}</p>
                  </div>
                  <button onClick={() => handleDelete(s.id)} className="text-xs text-ink/40 hover:text-red-600">
                    Remove
                  </button>
                </div>
                {s.tools && s.tools.length > 0 ? (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {s.tools.map((t) => (
                      <span key={t.name} title={t.description} className="rounded-full bg-sand px-2 py-0.5 text-[11px] text-ink/70">
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
        Local-only tools (like Blender or VS Code running on your machine)
        can't be reached directly from AgenticVenus since it's a hosted
        web app — expose them through a public HTTPS URL (a tunnel like
        ngrok, or the tool's own remote-server mode) first, then connect
        that URL here the same way.
      </p>
    </SlideOverPanel>
  );
}