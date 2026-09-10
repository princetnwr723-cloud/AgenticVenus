"use client";

// components/FilesPanel.tsx
// Every file in THIS conversation only — files the user uploaded (images,
// 3D assets) and files the agent itself wrote in Codespace. Switching to
// a different chat shows that chat's own files instead.

import { filesFromMessages, type FileEntry } from "@/lib/files";
import type { ChatMessage } from "@/lib/chatClient";
import SlideOverPanel from "@/components/SlideOverPanel";

type Props = {
  open: boolean;
  onClose: () => void;
  messages: ChatMessage[];
};

const CODE_ICON: Record<string, string> = {
  html: "🌐", css: "🎨", js: "📜", jsx: "⚛️", tsx: "⚛️", ts: "📘",
  py: "🐍", json: "🗂️", md: "📝",
};

function iconFor(entry: FileEntry): string {
  if (entry.kind === "generated") return CODE_ICON[entry.file.language] || "📄";
  if (entry.attachment.mimeType.startsWith("image/")) return "🖼️";
  return "🧊"; // 3D asset or other binary
}

function nameFor(entry: FileEntry): string {
  return entry.kind === "generated" ? entry.file.filename : entry.attachment.name;
}

export default function FilesPanel({ open, onClose, messages }: Props) {
  const files = filesFromMessages(messages);

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Files" subtitle="Uploaded or built in this conversation.">
      {files.length === 0 ? (
        <p className="text-sm text-ink/40">
          Nothing yet in this chat — attach a file with the + button, or ask the Developer Agent to build something.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {files.map((f, i) => (
            <div key={i} className="overflow-hidden rounded-md border border-ink/10 bg-white">
              {f.kind === "upload" && f.attachment.mimeType.startsWith("image/") ? (
                <img src={f.attachment.dataUrl} alt={f.attachment.name} className="h-28 w-full object-cover" />
              ) : (
                <div className="flex h-28 w-full items-center justify-center bg-sand text-3xl">{iconFor(f)}</div>
              )}
              <div className="p-2">
                <p className="truncate text-xs font-medium text-ink">{nameFor(f)}</p>
                <p className="truncate text-[11px] text-ink/45">
                  {f.kind === "generated" ? "built by agent" : "uploaded"}
                </p>
              </div>
            </div>
          ))}
        </div>
      )}
    </SlideOverPanel>
  );
}