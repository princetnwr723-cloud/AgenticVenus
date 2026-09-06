"use client";

// components/PluginsPanel.tsx
// Shows every plugin category and tool (matching Grok's real connector
// list), and lets the user mark tools as connected so the agent knows
// what it has access to. Marking "connected" here is a placeholder —
// each service's real OAuth flow is the next step — but it's what powers
// tool-awareness in chat today (see lib/toolDetect.ts).

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { PLUGIN_CATEGORIES, PLUGIN_TOOLS } from "@/lib/plugins";
import { connectPlugin, disconnectPlugin, listConnectedPluginIds } from "@/lib/pluginConnections";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  highlightToolId?: string | null;
  onConnectionsChange?: (connectedIds: string[]) => void;
};

export default function PluginsPanel({ uid, open, onClose, highlightToolId, onConnectionsChange }: Props) {
  const [connected, setConnected] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

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

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Plugins"
      subtitle="Mark the tools your agent should be able to use."
    >
      <div className="space-y-8">
        {PLUGIN_CATEGORIES.map((cat) => (
          <div key={cat.id}>
            <h3 className="text-sm font-medium text-ink">{cat.label}</h3>
            <p className="mt-0.5 text-xs text-ink/50">{cat.blurb}</p>
            <div className="mt-3 space-y-2">
              {PLUGIN_TOOLS.filter((t) => t.category === cat.id).map((tool) => {
                const isConnected = connected.includes(tool.id);
                const isHighlighted = highlightToolId === tool.id;
                return (
                  <div
                    key={tool.id}
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
                    <button
                      onClick={() => toggle(tool.id)}
                      disabled={loading || busyId === tool.id}
                      className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        isConnected
                          ? "border-moss/30 bg-moss/10 text-moss hover:bg-moss/20"
                          : "border-ink/10 text-ink/60 hover:bg-sand hover:text-ink"
                      }`}
                    >
                      {busyId === tool.id ? "..." : isConnected ? "Connected ✓" : "Connect"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-ink/40">
        "Connect" marks a tool as available to your agent for now — wiring
        each one to its real account (OAuth) is the next step. Once
        connected, the agent knows it can use it when you ask.
      </p>
    </SlideOverPanel>
  );
}