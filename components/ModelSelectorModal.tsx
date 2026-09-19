"use client";

import { useState } from "react";
import { saveConnection } from "@/lib/connections";
import { PROVIDERS, type Provider } from "@/lib/providers";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  onConnected: (provider: Provider, apiKey: string) => void;
  forceSelect?: boolean;
};

export default function ModelSelectorModal({
  uid,
  open,
  onClose,
  onConnected,
  forceSelect = false,
}: Props) {
  const [selected, setSelected] = useState<Provider | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  function reset() {
    setSelected(null);
    setApiKey("");
    setError(null);
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleConnect() {
    if (!selected || !apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await saveConnection(selected.id, selected.name, apiKey.trim());
      onConnected(selected, apiKey.trim());
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save the connection. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4"
      role="dialog"
      aria-modal="true"
      onClick={forceSelect ? undefined : handleClose}
    >
      <div
        className="animate-scale-in max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-card bg-cream p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {!selected ? (
          <>
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-xl text-ink">
                {forceSelect ? "Set up your AI to get started" : "Choose your AI provider"}
              </h2>
              {!forceSelect && (
                <button onClick={handleClose} aria-label="Close" className="focus-ring rounded-md p-1 text-ink/50 hover:text-ink">
                  ✕
                </button>
              )}
            </div>
            <p className="mt-1 text-sm text-ink/60">
              {forceSelect
                ? "Choose a provider and connect your own API key — this only takes a minute."
                : "Pick a provider to connect with your own API key."}
            </p>

            <div className="mt-5 grid gap-2">
              {PROVIDERS.map((provider) => (
                <button
                  key={provider.id}
                  onClick={() => setSelected(provider)}
                  className="focus-ring flex items-center gap-3 rounded-md border border-ink/10 bg-white px-4 py-3 text-left transition-all hover:-translate-y-0.5 hover:border-clay/40 hover:bg-sand hover:shadow-sm"
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: provider.accent }} />
                  <span className="flex-1">
                    <span className="block text-sm font-medium text-ink">{provider.name}</span>
                    <span className="block text-xs text-ink/55">{provider.description}</span>
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center justify-between">
              <button onClick={() => setSelected(null)} className="focus-ring rounded-md px-1 text-sm text-ink/60 hover:text-ink">
                ← Back
              </button>
              {!forceSelect && (
                <button onClick={handleClose} aria-label="Close" className="focus-ring rounded-md p-1 text-ink/50 hover:text-ink">
                  ✕
                </button>
              )}
            </div>

            <div className="mt-3 flex items-center gap-3">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: selected.accent }} />
              <h2 className="font-serif text-xl text-ink">{selected.name}</h2>
            </div>
            <p className="mt-2 text-sm text-ink/60">{selected.keyHint}</p>

            <label htmlFor="apiKey" className="mb-1 mt-5 block text-sm text-ink/70">
              API key
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={selected.keyPlaceholder}
              className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
            />
            <a href={selected.keyDocsUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-clay hover:underline">
              Where do I find this?
            </a>

            {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

            <button
              onClick={handleConnect}
              disabled={!apiKey.trim() || saving}
              className="focus-ring mt-6 w-full rounded-md bg-clay px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark disabled:opacity-50 disabled:hover:scale-100"
            >
              {saving ? "Connecting..." : `Connect ${selected.name}`}
            </button>
          </>
        )}
      </div>
    </div>
  );
}