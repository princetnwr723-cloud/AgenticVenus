"use client";

// components/PluginsPanel.tsx
// Shows the three plugin categories (Automation, Search & Data,
// Productivity) with the tools planned for each. Wiring real connections
// is next — for now this lists what's coming, per the agreed plan.

import SlideOverPanel from "@/components/SlideOverPanel";
import { PLUGIN_CATEGORIES, PLUGIN_TOOLS } from "@/lib/plugins";

type Props = {
  open: boolean;
  onClose: () => void;
};

export default function PluginsPanel({ open, onClose }: Props) {
  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Plugins"
      subtitle="Extend your agent with tools it can call on your behalf."
    >
      <div className="space-y-8">
        {PLUGIN_CATEGORIES.map((cat) => (
          <div key={cat.id}>
            <h3 className="text-sm font-medium text-ink">{cat.label}</h3>
            <p className="mt-0.5 text-xs text-ink/50">{cat.blurb}</p>
            <div className="mt-3 space-y-2">
              {PLUGIN_TOOLS.filter((t) => t.category === cat.id).map((tool) => (
                <div
                  key={tool.id}
                  className="flex items-center gap-3 rounded-md border border-ink/10 bg-white px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:shadow-sm"
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
                    disabled
                    title="Connecting comes next"
                    className="shrink-0 cursor-not-allowed rounded-md border border-ink/10 px-3 py-1.5 text-xs font-medium text-ink/35"
                  >
                    Connect
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </SlideOverPanel>
  );
}
