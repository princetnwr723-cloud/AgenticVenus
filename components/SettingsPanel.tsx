"use client";

// components/SettingsPanel.tsx
// Lives next to Agent Team and Codespace in the chat top bar. Lets the
// user pick which connected provider THIS conversation uses, connect
// additional providers, and connect a Telegram bot to this specific
// conversation (each conversation can use its own bot — you're never
// locked into one Telegram account for everything).

import { useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import type { SavedConnection } from "@/lib/connections";
import { connectTelegram, disconnectTelegram } from "@/lib/telegram";
import type { ChatRecord } from "@/lib/chats";

type Props = {
  open: boolean;
  onClose: () => void;
  connections: SavedConnection[];
  activeProviderId: string | null;
  onSelectProvider: (providerId: string) => void;
  onConnectAnother: () => void;
  chatId: string | null;
  telegram: ChatRecord["telegram"];
  onTelegramChange: (telegram: ChatRecord["telegram"]) => void;
  ceoMode: boolean;
  onCeoModeChange: (enabled: boolean) => void;
};

export default function SettingsPanel({
  open,
  onClose,
  connections,
  activeProviderId,
  onSelectProvider,
  onConnectAnother,
  chatId,
  telegram,
  onTelegramChange,
  ceoMode,
  onCeoModeChange,
}: Props) {
  const [botToken, setBotToken] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnectTelegram() {
    if (!chatId) {
      setError("Send a message first so this conversation is saved, then connect Telegram.");
      return;
    }
    if (!botToken.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const botUsername = await connectTelegram(chatId, botToken.trim());
      onTelegramChange({ botToken: botToken.trim(), botUsername });
      setBotToken("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect Telegram.");
    } finally {
      setConnecting(false);
    }
  }

  async function handleDisconnectTelegram() {
    if (!chatId) return;
    setConnecting(true);
    try {
      await disconnectTelegram(chatId, telegram?.botToken);
      onTelegramChange(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to disconnect Telegram.");
    } finally {
      setConnecting(false);
    }
  }

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

      <p className="mt-4 text-xs text-ink/40">
        Switching here only changes the provider for this conversation.
        Your sidebar default stays the same until you switch that
        separately.
      </p>

      {/* Telegram — per-conversation */}
      <div className="mt-8 border-t border-ink/10 pt-6">
        <h3 className="text-sm font-medium text-ink">Telegram</h3>
        <p className="mt-1 text-xs text-ink/50">
          Connect a Telegram bot to just this conversation — talk to this
          agent from Telegram too. Each conversation can use its own bot.
        </p>

        {telegram?.botUsername ? (
          <div className="mt-3 flex items-center justify-between rounded-md border border-ink/10 bg-white px-4 py-3">
            <div>
              <p className="text-sm font-medium text-ink">Connected</p>
              <p className="text-xs text-ink/50">@{telegram.botUsername}</p>
            </div>
            <button
              onClick={handleDisconnectTelegram}
              disabled={connecting}
              className="text-xs text-ink/40 hover:text-red-600 disabled:opacity-50"
            >
              Disconnect
            </button>
          </div>
        ) : (
          <div className="mt-3 space-y-2">
            <input
              value={botToken}
              onChange={(e) => setBotToken(e.target.value)}
              placeholder="Bot token from @BotFather"
              className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
            />
            <button
              onClick={handleConnectTelegram}
              disabled={!botToken.trim() || connecting}
              className="focus-ring w-full rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] disabled:opacity-50 disabled:hover:scale-100"
            >
              {connecting ? "Connecting..." : "Connect Telegram"}
            </button>
          </div>
        )}

        {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

        <p className="mt-3 text-xs text-ink/35">
          Don&apos;t have a bot yet? Message{" "}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noreferrer"
            className="text-clay hover:underline"
          >
            @BotFather
          </a>{" "}
          on Telegram, send <code>/newbot</code>, and paste the token it
          gives you above.
        </p>
      </div>

      {/* CEO Mode */}
      <div className="mt-8 border-t border-ink/10 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-medium text-ink">CEO Mode</h3>
            <p className="mt-1 max-w-xs text-xs text-ink/50">
              Every hour, the agent surveys what's connected (email, MCP
              tools) and takes reasonable action on its own — replying to
              something important, flagging an issue it finds, etc.
            </p>
          </div>
          <button
            onClick={() => chatId && onCeoModeChange(!ceoMode)}
            disabled={!chatId}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-40 ${
              ceoMode ? "bg-clay" : "bg-ink/15"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                ceoMode ? "translate-x-5" : "translate-x-0.5"
              }`}
            />
          </button>
        </div>
        {!chatId && (
          <p className="mt-2 text-xs text-amber-700">Send a message first so this chat is saved.</p>
        )}
        <p className="mt-3 text-xs text-ink/35">
          Only runs while this tab stays open (same as Scheduler) — true
          background operation while the app is closed needs a server-side
          cron job, which is a further step.
        </p>
      </div>
    </SlideOverPanel>
  );
}