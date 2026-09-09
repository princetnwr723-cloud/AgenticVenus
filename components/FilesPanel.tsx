"use client";

// components/FilesPanel.tsx
// Every file across every conversation, in one place — files the user
// uploaded (images, 3D assets) AND files the agent itself wrote in
// Codespace. Click one to jump back to that chat.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { listAllFiles, type FileEntry } from "@/lib/files";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
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

export default function FilesPanel({ uid, open, onClose, onOpenChat }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    listAllFiles(uid).then((f) => {
      setFiles(f);
      setLoading(false);
    });
  }, [open, uid]);

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Files" subtitle="Everything uploaded or built across your chats.">
      {loading ? (
        <p className="text-sm text-ink/50">Loading...</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-ink/40">
          Nothing yet — attach a file with the + button, or ask the Developer Agent to build something.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {files.map((f, i) => (
            <button
              key={i}
              onClick={() => {
                onOpenChat(f.chatId);
                onClose();
              }}
              className="group overflow-hidden rounded-md border border-ink/10 bg-white text-left transition-all hover:-translate-y-0.5 hover:shadow-sm"
            >
              {f.kind === "upload" && f.attachment.mimeType.startsWith("image/") ? (
                <img src={f.attachment.dataUrl} alt={f.attachment.name} className="h-28 w-full object-cover" />
              ) : (
                <div className="flex h-28 w-full items-center justify-center bg-sand text-3xl">
                  {iconFor(f)}
                </div>
              )}
              <div className="p-2">
                <p className="truncate text-xs font-medium text-ink">{nameFor(f)}</p>
                <p className="truncate text-[11px] text-ink/45">
                  {f.kind === "generated" ? "built by agent · " : ""}from "{f.chatTitle}"
                </p>
              </div>
            </button>
          ))}
        </div>
      )}
    </SlideOverPanel>
  );
}