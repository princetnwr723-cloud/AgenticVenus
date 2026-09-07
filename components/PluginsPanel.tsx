"use client";

// components/PluginsPanel.tsx
// Tools with a dedicated OAuth app (see lib/oauthProviders.ts) show a
// real "Continue with X" button — click it, log in on that service,
// approve access, and you're back here connected for real, exactly like
// Grok or Claude's plugin pickers. Tools with a public MCP server but no
// dedicated app open the MCP connect flow instead. Everything else still
// shows the placeholder toggle until one of those paths is wired for it.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { PLUGIN_CATEGORIES, PLUGIN_TOOLS } from "@/lib/plugins";
import { connectPlugin, connectPluginWithApiKey, disconnectPlugin, listConnectedPluginIds } from "@/lib/pluginConnections";
import { startPluginOAuth } from "@/lib/pluginOrchestrator";
import { OAUTH_PROVIDERS } from "@/lib/oauthProviders";
import { API_KEY_PROVIDERS } from "@/lib/apiKeyProviders";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  highlightToolId?: string | null;
  onConnectionsChange?: (connectedIds: string[]) => void;
  onOpenMcpWithPrefill?: (name: string, url: string) => void;
};

export default function PluginsPanel({
  uid,
  open,
  onClose,
  highlightToolId,
  onConnectionsChange,
  onOpenMcpWithPrefill,
}: Props) {
  const [connected, setConnected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keyInputToolId, setKeyInputToolId] = useState<string | null>(null);
  const [keyInputValue, setKeyInputValue] = useState("");

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const ids = await listConnectedPluginIds(uid);
      setConnected(ids);
      setLoading(false);
    })();
  }, [open, uid]);

  async function toggle(toolId: string) {
    setBusyId(toolId);
    const isConnected = connected.includes(toolId);
    if (isConnected) {
      await disconnectPlugin(uid, toolId);
      const next = connected.filter((id) => id !== toolId);
      setConnected(next);
      onConnectionsChange?.(next);
    } else {
      await connectPlugin(uid, toolId);
      const next = [...connected, toolId];
      setConnected(next);
      onConnectionsChange?.(next);
    }
    setBusyId(null);
  }

  async function handleOAuthConnect(toolId: string) {
    setBusyId(toolId);
    setError(null);
    try {
      const authUrl = await startPluginOAuth(toolId);
      window.location.href = authUrl;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start login.");
      setBusyId(null);
    }
  }

  async function handleSaveApiKey(toolId: string) {
    if (!keyInputValue.trim()) return;
    setBusyId(toolId);
    await connectPluginWithApiKey(uid, toolId, keyInputValue.trim());
    const next = [...connected, toolId];
    setConnected(next);
    onConnectionsChange?.(next);
    setKeyInputToolId(null);
    setKeyInputValue("");
    setBusyId(null);
  }

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Plugins"
      subtitle="Connect the tools your agent should be able to use."
    >
      {error && <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}

      <div className="space-y-8">
        {PLUGIN_CATEGORIES.map((cat) => (
          <div key={cat.id}>
            <h3 className="text-sm font-medium text-ink">{cat.label}</h3>
            <p className="mt-0.5 text-xs text-ink/50">{cat.blurb}</p>
            <div className="mt-3 space-y-2">
              {PLUGIN_TOOLS.filter((t) => t.category === cat.id).map((tool) => {
                const isConnected = connected.includes(tool.id);
                const isHighlighted = highlightToolId === tool.id;
                const hasOwnOAuth = !!OAUTH_PROVIDERS[tool.id];
                const apiKeyProvider = API_KEY_PROVIDERS[tool.id];
                const isEnteringKey = keyInputToolId === tool.id;

                return (
                  <div key={tool.id}>
                    <div
                      className={`flex items-center gap-3 rounded-md border px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                        isHighlighted ? "border-clay bg-clay/5" : "border-ink/10 bg-white"
                      }`}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
                        style={{ backgroundColor: tool.color }}
                      >
                        {tool.name.charAt(0)}
                      </span>
                      <div className="flex-1">
                        <p className="text-sm font-medium text-ink">{tool.name}</p>
                        <p className="text-xs text-ink/50">{tool.description}</p>
                      </div>

                      {isConnected ? (
                        <button
                          onClick={() => toggle(tool.id)}
                          disabled={busyId === tool.id}
                          className="shrink-0 rounded-md border border-moss/30 bg-moss/10 px-3 py-1.5 text-xs font-medium text-moss transition-colors hover:bg-moss/20 disabled:opacity-50"
                        >
                          {busyId === tool.id ? "..." : "Connected ✓"}
                        </button>
                      ) : hasOwnOAuth ? (
                        <button
                          onClick={() => handleOAuthConnect(tool.id)}
                          disabled={busyId === tool.id}
                          className="shrink-0 rounded-md bg-clay px-3 py-1.5 text-xs font-medium text-cream transition-all hover:scale-[1.03] hover:bg-clay-dark disabled:opacity-50"
                        >
                          {busyId === tool.id ? "Redirecting..." : `Continue with ${tool.name}`}
                        </button>
                      ) : apiKeyProvider ? (
                        <button
                          onClick={() => {
                            setKeyInputToolId(isEnteringKey ? null : tool.id);
                            setKeyInputValue("");
                          }}
                          className="shrink-0 rounded-md border border-clay/30 bg-clay/10 px-3 py-1.5 text-xs font-medium text-clay transition-colors hover:bg-clay/20"
                        >
                          {isEnteringKey ? "Cancel" : "Add API key"}
                        </button>
                      ) : tool.mcpUrl ? (
                        <button
                          onClick={() => onOpenMcpWithPrefill?.(tool.name, tool.mcpUrl!)}
                          className="shrink-0 rounded-md border border-clay/30 bg-clay/10 px-3 py-1.5 text-xs font-medium text-clay transition-colors hover:bg-clay/20"
                        >
                          Connect (real)
                        </button>
                      ) : (
                        <button
                          onClick={() => toggle(tool.id)}
                          disabled={busyId === tool.id}
                          className="shrink-0 rounded-md border border-ink/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition-colors hover:bg-sand hover:text-ink disabled:opacity-50"
                        >
                          {busyId === tool.id ? "..." : "Connect"}
                        </button>
                      )}
                    </div>

                    {isEnteringKey && apiKeyProvider && (
                      <div className="mt-2 flex items-center gap-2 rounded-md border border-clay/20 bg-clay/5 px-3 py-2.5">
                        <input
                          value={keyInputValue}
                          onChange={(e) => setKeyInputValue(e.target.value)}
                          placeholder={apiKeyProvider.keyLabel}
                          className="focus-ring flex-1 rounded-md border border-ink/15 bg-white px-2.5 py-1.5 text-xs outline-none"
                        />
                        <button
                          onClick={() => handleSaveApiKey(tool.id)}
                          disabled={!keyInputValue.trim() || busyId === tool.id}
                          className="shrink-0 rounded-md bg-clay px-3 py-1.5 text-xs font-medium text-cream transition-colors hover:bg-clay-dark disabled:opacity-50"
                        >
                          Save
                        </button>
                        <a
                          href={apiKeyProvider.helpUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="shrink-0 text-xs text-clay hover:underline"
                        >
                          Get key
                        </a>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-ink/40">
        <strong className="text-clay">Continue with X</strong> is a real
        login — the agent can actually use it afterward.{" "}
        <strong className="text-clay">Add API key</strong> is for tools
        powered by a single key/token rather than an account login.{" "}
        <strong className="text-clay">Connect (real)</strong> opens the
        same real flow through that tool's official MCP server. Plain
        "Connect" just marks a tool as available for now.
      </p>
    </SlideOverPanel>
  );
}