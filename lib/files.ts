// lib/files.ts
// Collects every attachment (image) across all of a user's saved chats,
// so the Files panel can show them in one place — the agent already
// "remembers" them within a chat since they're stored inline in that
// chat's message history; this just makes them browsable across chats
// too, the way Claude's Files view does.

import { listChats, getChat } from "@/lib/chats";
import type { Attachment } from "@/lib/chatClient";

export type FileEntry = {
  chatId: string;
  chatTitle: string;
  attachment: Attachment;
};

export async function listAllFiles(uid: string): Promise<FileEntry[]> {
  const summaries = await listChats(uid);
  const entries: FileEntry[] = [];

  for (const summary of summaries) {
    const chat = await getChat(uid, summary.id);
    if (!chat) continue;
    for (const message of chat.messages) {
      for (const attachment of message.attachments || []) {
        entries.push({ chatId: chat.id, chatTitle: chat.title, attachment });
      }
    }
  }

  return entries;
}