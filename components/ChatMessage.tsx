"use client";

// components/ChatMessage.tsx
// A single message in the conversation, styled the way Claude renders
// chat: user turns as a right-aligned rounded bubble, assistant turns as
// plain full-width text. Each message fades in as it's added.

import type { ChatMessage as ChatMessageType } from "@/lib/chatClient";

export function ChatMessageItem({ message }: { message: ChatMessageType }) {
  if (message.role === "user") {
    return (
      <div className="animate-fade-in-up flex justify-end">
        <div className="max-w-[75%] rounded-2xl bg-sand px-4 py-2.5 text-[15px] leading-relaxed text-ink">
          {message.content}
        </div>
      </div>
    );
  }

  return (
    <div className="animate-fade-in-up flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-clay text-[11px] font-semibold text-cream">
        V
      </span>
      <p className="max-w-[80%] whitespace-pre-wrap text-[15px] leading-relaxed text-ink">
        {message.content}
      </p>
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