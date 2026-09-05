"use client";

// components/ModelDropdown.tsx
// Lives in the chat top bar. Shows the model currently in use for the
// active connection, and lets the user pick from a real, live list of
// models their key can actually use — this is what prevents "model not
// found" errors going forward.

import { useEffect, useState } from "react";
import { fetchAvailableModels, FALLBACK_MODELS } from "@/lib/modelList";
import type { Provider } from "@/lib/providers";

type Props = {
  provider: Provider;
  apiKey: string;
  selectedModel: string | null;
  onChange: (model: string) => void;
};

export default function ModelDropdown({ provider, apiKey, selectedModel, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<string[]>(FALLBACK_MODELS[provider.id] ?? []);
  const [loading, setLoading] = useState(false);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    if (!open || fetched) return;
    setLoading(true);
    fetchAvailableModels(provider.id, apiKey).then((list) => {
      if (list.length) setModels(list);
      setLoading(false);
      setFetched(true);
    });
  }, [open, fetched, provider.id, apiKey]);

  const current = selectedModel || models[0] || "default";

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="focus-ring flex items-center gap-2 rounded-md border border-ink/10 bg-white px-3 py-1.5 text-xs font-medium text-ink/80 transition-all hover:-translate-y-0.5 hover:shadow-sm"
      >
        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: provider.accent }} />
        {current}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
          <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          className="animate-scale-in absolute right-0 top-full z-20 mt-2 max-h-72 w-64 overflow-y-auto rounded-card border border-ink/10 bg-cream p-2 shadow-xl"
          onMouseLeave={() => setOpen(false)}
        >
          <p className="px-2 py-1 text-xs font-medium uppercase tracking-wide text-ink/35">
            {provider.name} models
          </p>
          {loading ? (
            <p className="px-2 py-2 text-sm text-ink/50">Loading available models...</p>
          ) : (
            models.map((m) => (
              <button
                key={m}
                onClick={() => {
                  onChange(m);
                  setOpen(false);
                }}
                className={`block w-full truncate rounded-md px-2 py-2 text-left text-sm ${
                  m === current ? "bg-sand text-ink" : "text-ink/70 hover:bg-sand/60"
                }`}
              >
                {m}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}