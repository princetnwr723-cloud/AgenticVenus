// lib/files.ts
// Collects everything that should show up in the Files panel — both
// files the user uploaded (images, 3D assets) AND files the agent itself
// wrote in Codespace — across every one of the user's saved chats, the
// way Claude's Files view brings everything into one place.

import { listChats, getChat } from "@/lib/chats";
import type { Attachment } from "@/lib/chatClient";
import { extractCodeFiles, type CodeFile } from "@/lib/codeExtract";

export type FileEntry =
  | { kind: "upload"; chatId: string; chatTitle: string; attachment: Attachment }
  | { kind: "generated"; chatId: string; chatTitle: string; file: CodeFile };

export async function listAllFiles(uid: string): Promise<FileEntry[]> {
  const summaries = await listChats(uid);
  const entries: FileEntry[] = [];

  for (const summary of summaries) {
    const chat = await getChat(uid, summary.id);
    if (!chat) continue;

    for (const message of chat.messages) {
      for (const attachment of message.attachments || []) {
        entries.push({ kind: "upload", chatId: chat.id, chatTitle: chat.title, attachment });
      }
    }

    for (const file of extractCodeFiles(chat.messages)) {
      entries.push({ kind: "generated", chatId: chat.id, chatTitle: chat.title, file });
    }
  }

  return entries;
}