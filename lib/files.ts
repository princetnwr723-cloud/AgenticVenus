// lib/files.ts
// Files for the Files panel — scoped to ONE chat only, not every chat.
// Uploads (images, 3D assets) come from that chat's own messages;
// generated files come from whatever the Developer Agent wrote in that
// same chat. A different chat's files never show up here.

import type { ChatMessage, Attachment } from "@/lib/chatClient";
import { extractCodeFiles, type CodeFile } from "@/lib/codeExtract";

export type FileEntry =
  | { kind: "upload"; attachment: Attachment }
  | { kind: "generated"; file: CodeFile };

export function filesFromMessages(messages: ChatMessage[]): FileEntry[] {
  const entries: FileEntry[] = [];

  for (const message of messages) {
    for (const attachment of message.attachments || []) {
      entries.push({ kind: "upload", attachment });
    }
  }

  for (const file of extractCodeFiles(messages)) {
    entries.push({ kind: "generated", file });
  }

  return entries;
}