"use client";

// components/ChatMessage.tsx
// A single message in the conversation. User turns get Edit + Copy below
// them (revealed on hover); assistant turns get Copy + a token-usage
// count below them, pulled from the provider's own response (see
// lib/chatClient.ts's TokenUsage).
//
// Any fenced code block in an assistant message is pulled out and shown
// as a Claude-style clickable file card (CodeFileCard) instead of a raw
// code block — clicking one opens that file in Codespace via onOpenFile.

import { useState } from "react";
import type { ChatMessage as ChatMessageType } from "@/lib/chatClient";
import { renderMarkdown } from "@/lib/markdown";
import CodeFileCard from "@/components/CodeFileCard";
import type { CodeFile } from "@/lib/codeExtract";

type Props = {
  message: ChatMessageType;
  onEdit?: (content: string) => void;
  onOpenFile?: (fileId: string) => void;
};

type MessagePart =
  | { type: "text"; content: string }
  | { type: "file"; file: CodeFile };

const FENCE_RE = /```(\w+)?\n([\s\S]*?)```/g;

/** Splits an assistant message into plain-text chunks and fenced code
 * blocks, so code blocks can be rendered as real React components
 * (CodeFileCard) instead of being baked into the renderMarkdown HTML
 * string. */
function splitTextAndCode(content: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let lastIndex = 0;
  let autoIndex = 0;
  let match: RegExpExecArray | null;

  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(content)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ type: "text", content: content.slice(lastIndex, match.index) });
    }

    const language = match[1] || "text";
    const body = match[2].trim();
    const firstLine = body.split("\n")[0];
    const filenameMatch = firstLine.match(/filename:\s*(\S+)/i);
    const filename = filenameMatch ? filenameMatch[1] : `snippet-${++autoIndex}.${language}`;
    const code = filenameMatch ? body.split("\n").slice(1).join("\n") : body;

    parts.push({ type: "file", file: { id: filename, filename, language, code } });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < content.length) {
    parts.push({ type: "text", content: content.slice(lastIndex) });
  }
  if (parts.length === 0) {
    parts.push({ type: "text", content });
  }
  return parts;
}

export function ChatMessageItem({ message, onEdit, onOpenFile }: Props) {
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
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-1.5 flex flex-wrap justify-end gap-1.5">
            {message.attachments.map((a, i) =>
              a.mimeType.startsWith("image/") ? (
                <img key={i} src={a.dataUrl} alt={a.name} className="h-20 w-20 rounded-lg object-cover" />
              ) : (
                <span key={i} className="flex items-center gap-1.5 rounded-lg border border-ink/10 bg-white px-2.5 py-1.5 text-xs text-ink/70">
                  🧊 {a.name}
                </span>
              )
            )}
          </div>
        )}
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

  const parts = splitTextAndCode(message.content);

  return (
    <div className="animate-fade-in-up group flex gap-3">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-clay text-[11px] font-semibold text-cream">
        V
      </span>
      <div className="min-w-0 flex-1">
        <div className="max-w-[85%] rounded-2xl bg-cream-dark/70 px-4 py-3">
          {parts.map((part, i) =>
            part.type === "file" ? (
              <CodeFileCard key={i} file={part.file} onOpen={(fileId) => onOpenFile?.(fileId)} />
            ) : (
              <div
                key={i}
                className="text-[15px] leading-relaxed text-ink [&_br]:content-['']"
                dangerouslySetInnerHTML={{ __html: renderMarkdown(part.content) }}
              />
            )
          )}
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