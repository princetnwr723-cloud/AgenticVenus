"use client";

// components/ToolConnectPrompt.tsx
// Shown inline in the chat when the agent detects the user's request
// needs a tool it doesn't have access to yet. If the tool is in our
// plugin catalog, offers to open Plugins to connect it. If it's not a
// known plugin, points the user to MCP Tools instead.

import type { ToolNeed } from "@/lib/plugins";

type Props = {
  need: ToolNeed;
  onOpenPlugins: () => void;
  onOpenMCP: () => void;
};

export default function ToolConnectPrompt({ need, onOpenPlugins, onOpenMCP }: Props) {
  return (
    <div className="animate-fade-in-up flex items-start gap-3 rounded-card border border-clay/25 bg-clay/5 px-4 py-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-clay text-[11px] font-semibold text-cream">
        V
      </span>
      <div>
        <p className="text-sm text-ink">
          This looks like it needs <strong>{need.toolName}</strong>, and it
          isn&apos;t connected yet.
        </p>
        {need.known ? (
          <button
            onClick={onOpenPlugins}
            className="focus-ring mt-2 rounded-md bg-clay px-3 py-1.5 text-xs font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark"
          >
            Connect {need.toolName} in Plugins
          </button>
        ) : (
          <>
            <p className="mt-1 text-xs text-ink/55">
              It&apos;s not one of the built-in plugins, but you can give the
              agent access to it through MCP.
            </p>
            <button
              onClick={onOpenMCP}
              className="focus-ring mt-2 rounded-md border border-ink/15 bg-white px-3 py-1.5 text-xs font-medium text-ink transition-all hover:scale-[1.02] hover:bg-sand"
            >
              Set up in MCP Tools
            </button>
          </>
        )}
      </div>
    </div>
  );
}