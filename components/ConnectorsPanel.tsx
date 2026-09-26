"use client";

// components/ConnectorsPanel.tsx
// One sidebar entry point ("Connectors") instead of two separate ones —
// Plugins and MCP Tools are now tabs inside the same slide-over, each
// rendered "embedded" (see PluginsPanel/MCPPanel) so their own logic is
// unchanged, just not wrapped in a second slide-over shell.

import { useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import PluginsPanel from "@/components/PluginsPanel";
import MCPPanel from "@/components/MCPPanel";

type Tab = "plugins" | "mcp";

type Props = {
  uid: string;
  open: boolean;
  initialTab?: Tab;
  onClose: () => void;
  highlightToolId?: string | null;
  onConnectionsChange?: (connectedIds: string[]) => void;
  mcpPrefill?: { name: string; url: string } | null;
  onMcpRefreshed?: () => void;
  maxAllowed: number;
  currentTotal: number;
  onUpgrade: () => void;
};

export default function ConnectorsPanel({
  uid,
  open,
  initialTab = "plugins",
  onClose,
  highlightToolId,
  onConnectionsChange,
  mcpPrefill,
  onMcpRefreshed,
  maxAllowed,
  currentTotal,
  onUpgrade,
}: Props) {
  const [tab, setTab] = useState<Tab>(initialTab);

  // A prefill (from "Connect X in Plugins" -> MCP fallback, or the agent
  // saying "connect this MCP: ...") should jump straight to the MCP tab.
  if (open && mcpPrefill && tab !== "mcp") setTab("mcp");

  return (
    <SlideOverPanel
      open={open}
      onClose={() => {
        onClose();
        if (tab === "mcp") onMcpRefreshed?.();
      }}
      title="Connectors"
      subtitle="Everything your agent can reach — built-in plugins and real MCP servers, in one place."
    >
      <div className="mb-5 flex overflow-hidden rounded-md border border-ink/10">
        <button
          onClick={() => setTab("plugins")}
          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "plugins" ? "bg-clay/10 text-clay" : "bg-white text-ink/60 hover:bg-sand"
          }`}
        >
          Plugins
        </button>
        <button
          onClick={() => setTab("mcp")}
          className={`flex-1 px-3 py-2 text-sm font-medium transition-colors ${
            tab === "mcp" ? "bg-clay/10 text-clay" : "bg-white text-ink/60 hover:bg-sand"
          }`}
        >
          MCP Tools
        </button>
      </div>

      <PluginsPanel
        uid={uid}
        open={open && tab === "plugins"}
        onClose={() => {}}
        embedded
        highlightToolId={highlightToolId}
        onConnectionsChange={onConnectionsChange}
        onOpenMcpWithPrefill={() => setTab("mcp")}
        maxAllowed={maxAllowed}
        currentTotal={currentTotal}
        onUpgrade={onUpgrade}
      />
      <MCPPanel uid={uid} open={open && tab === "mcp"} onClose={() => {}} prefill={tab === "mcp" ? mcpPrefill : null} embedded />
    </SlideOverPanel>
  );
}