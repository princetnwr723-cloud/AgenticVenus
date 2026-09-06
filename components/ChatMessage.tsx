"use client";

// components/ChatMessage.tsx
// A single message in the conversation. User turns get Edit + Copy below
// them (revealed on hover); assistant turns get Copy + a token-usage
// count below them, pulled from the provider's own response (see
// lib/chatClient.ts's TokenUsage).

import { useState } from "react";
import type { ChatMessage as ChatMessageType } from "@/lib/chatClient";

type Props = {
  message: ChatMessageType;
  onEdit?: (content: string) => void;
};

export function ChatMessageItem({ message, onEdit }: Props) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      // Clipboard API can be blocked in some contexts — fail quietly.
    }
  }

  if (message.role === "user") {
    return (
      <div className="animate-fade-in-up group flex flex-col items-end">
        <div className="max-w-[75%] rounded-2xl bg-sand px-4 py-2.5 text-[15px] leading-relaxed text-ink">
          {message.content}
        </div>
        <div className="mt-1 flex gap-3 pr-1 opacity-0 transition-opacity group-hover:opacity-100">
          {onEdit && (
            <button onClick={() => onEdit(message.content)} className="text-xs text-ink/40 hover:text-ink">
              Edit
            </button>
          )}
          <button onClick={handleCopy} className="text-xs text-ink/40 hover:text-ink">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up group flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-clay text-[11px] font-semibold text-cream">
        V
      </span>
      <div className="min-w-0 flex-1">
        <div className="max-w-[85%] rounded-2xl bg-cream-dark/70 px-4 py-3">
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
            {message.content}
          </p>
        </div>
        <div className="mt-1 flex items-center gap-3 opacity-0 transition-opacity group-hover:opacity-100">
          <button onClick={handleCopy} className="text-xs text-ink/40 hover:text-ink">
            {copied ? "Copied" : "Copy"}
          </button>
          {message.usage && (
            <span className="text-xs text-ink/30">{message.usage.totalTokens} tokens</span>
          )}
        </div>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="animate-fade-in flex items-center gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-clay text-[11px] font-semibold text-cream">
        V
      </span>
      <span className="flex items-center gap-1.5 rounded-2xl bg-sand px-4 py-3">
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink/40" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink/40" />
        <span className="typing-dot h-1.5 w-1.5 rounded-full bg-ink/40" />
      </span>
    </div>
  );
}