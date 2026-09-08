"use client";

// components/FilesPanel.tsx
// Every image attached across every conversation, in one place — click
// one to jump back to that chat.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { listAllFiles, type FileEntry } from "@/lib/files";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  onOpenChat: (chatId: string) => void;
};

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
    <SlideOverPanel open={open} onClose={onClose} title="Files" subtitle="Everything attached across your chats.">
      {loading ? (
        <p className="text-sm text-ink/50">Loading...</p>
      ) : files.length === 0 ? (
        <p className="text-sm text-ink/40">No files attached yet — use the + button in any chat to add one.</p>
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
              <img src={f.attachment.dataUrl} alt={f.attachment.name} className="h-28 w-full object-cover" />
              <div className="p-2">
                <p className="truncate text-xs font-medium text-ink">{f.attachment.name}</p>
                <p className="truncate text-[11px] text-ink/45">from "{f.chatTitle}"</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </SlideOverPanel>
  );
}