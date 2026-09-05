"use client";

// components/SettingsPanel.tsx
// Lives next to Agent Team and Codespace in the chat top bar. Shows every
// provider the user has connected and lets them pick which one THIS
// conversation should use — separate from the sidebar's default
// connection — plus a way to connect another provider without going
// through the forced first-time setup flow again.

import SlideOverPanel from "@/components/SlideOverPanel";
import type { SavedConnection } from "@/lib/connections";

type Props = {
  open: boolean;
  onClose: () => void;
  connections: SavedConnection[];
  activeProviderId: string | null;
  onSelectProvider: (providerId: string) => void;
  onConnectAnother: () => void;
};

export default function SettingsPanel({
  open,
  onClose,
  connections,
  activeProviderId,
  onSelectProvider,
  onConnectAnother,
}: Props) {
  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle="Choose which connected provider this conversation uses."
    >
      <div className="space-y-2">
        {connections.length === 0 ? (
          <p className="text-sm text-ink/40">No providers connected yet.</p>
        ) : (
          connections.map((c) => (
            <button
              key={c.provider.id}
              onClick={() => onSelectProvider(c.provider.id)}
              className={`flex w-full items-center gap-3 rounded-md border px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm ${
                activeProviderId === c.provider.id
                  ? "border-clay/40 bg-clay/5"
                  : "border-ink/10 bg-white"
              }`}
            >
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: c.provider.accent }}
              />
              <span className="flex-1">
                <span className="block text-sm font-medium text-ink">{c.provider.name}</span>
                <span className="block text-xs text-ink/50">
                  {c.model || "Default model"}
                </span>
              </span>
              {activeProviderId === c.provider.id && (
                <span className="shrink-0 text-xs font-medium text-clay">In use</span>
              )}
            </button>
          ))
        )}
      </div>

      <button
        onClick={onConnectAnother}
        className="focus-ring mt-4 w-full rounded-md border border-dashed border-ink/20 px-4 py-3 text-sm font-medium text-ink/60 transition-all hover:border-clay/40 hover:bg-sand hover:text-ink"
      >
        + Connect another provider
      </button>

      <p className="mt-6 text-xs text-ink/40">
        Switching here only changes the provider for this conversation.
        Your sidebar default stays the same until you switch that
        separately.
      </p>
    </SlideOverPanel>
  );
}