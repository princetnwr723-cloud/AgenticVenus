"use client";

// components/Sidebar.tsx
// Left navigation for the workspace — mirrors Claude's layout:
// logo, "New chat", a chat list placeholder, and account/provider status
// pinned to the bottom.

import type { Provider } from "@/lib/providers";

type Props = {
  userLabel: string;
  connected: Provider | null;
  onNewChat: () => void;
  onSwitchModel: () => void;
  onLogout: () => void;
  hasMessages: boolean;
};

export default function Sidebar({
  userLabel,
  connected,
  onNewChat,
  onSwitchModel,
  onLogout,
  hasMessages,
}: Props) {
  return (
    <aside className="flex h-screen w-64 shrink-0 flex-col border-r border-black/5 bg-cream-dark/60">
      <div className="flex items-center gap-2 px-4 py-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-md bg-clay text-sm font-semibold text-cream">
          V
        </span>
        <span className="text-base font-medium">AgenticVenus</span>
      </div>

      <div className="px-3">
        <button
          onClick={onNewChat}
          className="focus-ring flex w-full items-center gap-2 rounded-md border border-ink/10 bg-white px-3 py-2.5 text-sm font-medium text-ink transition-all hover:-translate-y-0.5 hover:bg-sand hover:shadow-sm"
        >
          <svg width="15" height="15" viewBox="0 0 15 15" fill="none" aria-hidden="true">
            <path
              d="M7.5 2v11M2 7.5h11"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </svg>
          New chat
        </button>
      </div>

      <div className="mt-6 flex-1 overflow-y-auto px-3">
        <p className="px-2 text-xs font-medium uppercase tracking-wide text-ink/35">
          Chats
        </p>
        <div className="mt-2">
          {hasMessages ? (
            <div className="rounded-md bg-sand px-3 py-2 text-sm text-ink/80">
              Current chat
            </div>
          ) : (
            <p className="px-2 py-2 text-sm text-ink/40">
              Your conversations will show up here.
            </p>
          )}
        </div>
      </div>

      <div className="border-t border-black/5 px-3 py-4">
        <button
          onClick={onSwitchModel}
          className="focus-ring flex w-full items-center justify-between rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-sand"
        >
          <span className="flex items-center gap-2">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: connected?.accent ?? "#00000022" }}
            />
            <span className="text-ink/75">
              {connected ? connected.name : "No provider connected"}
            </span>
          </span>
          <span className="text-xs text-clay">Switch</span>
        </button>

        <div className="mt-3 flex items-center justify-between px-2">
          <span className="truncate text-xs text-ink/45">{userLabel}</span>
          <button
            onClick={onLogout}
            className="focus-ring shrink-0 text-xs text-ink/50 transition-colors hover:text-ink"
          >
            Log out
          </button>
        </div>
      </div>
    </aside>
  );
}