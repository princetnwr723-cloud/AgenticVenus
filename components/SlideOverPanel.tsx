"use client";

// components/SlideOverPanel.tsx
// Shared right-side slide-over used by Scheduler, Plugins, MCP Tools, and
// Business DNA — keeps their open/close animation and chrome consistent.

import type { ReactNode } from "react";

type Props = {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
};

export default function SlideOverPanel({
  open,
  title,
  subtitle,
  onClose,
  children,
}: Props) {
  if (!open) return null;

  return (
    <div
      className="animate-fade-in fixed inset-0 z-40 flex justify-end bg-ink/30"
      onClick={onClose}
    >
      <div
        className="animate-scale-in flex h-full w-full max-w-md flex-col overflow-y-auto bg-cream shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-black/5 px-6 py-5">
          <div>
            <h2 className="font-serif text-xl text-ink">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-ink/55">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="focus-ring rounded-md p-1 text-ink/50 hover:text-ink"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
