// lib/chats.ts
// Persists conversations so they show up in the sidebar and survive a
// refresh. Kept simple: each chat is one Firestore document holding its
// full message array (fine at this scale — a dedicated messages
// subcollection would be the next step for very long chat histories).

import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  Timestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ChatMessage } from "@/lib/chatClient";

export type ChatSummary = {
  id: string;
  title: string;
  updatedAt?: Timestamp;
};

export type ChatRecord = {
  id: string;
  title: string;
  messages: ChatMessage[];
  agentId?: string;
  providerId?: string;
  telegram?: { botToken: string; botUsername: string } | null;
};

export async function listChats(uid: string): Promise<ChatSummary[]> {
  const ref = collection(db, "users", uid, "chats");
  const q = query(ref, orderBy("updatedAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({
    id: d.id,
    title: d.data().title || "Untitled chat",
    updatedAt: d.data().updatedAt,
  }));
}

export async function getChat(uid: string, chatId: string): Promise<ChatRecord | null> {
  const ref = doc(db, "users", uid, "chats", chatId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data();
  return {
    id: snap.id,
    title: data.title || "Untitled chat",
    messages: data.messages || [],
    agentId: data.agentId,
    providerId: data.providerId,
    telegram: data.telegram ?? null,
  };
}

function titleFromMessage(message: string): string {
  const clean = message.trim().replace(/\s+/g, " ");
  return clean.length > 42 ? clean.slice(0, 42) + "…" : clean;
}

/** Creates a new chat doc from the first user message and returns its id. */
export async function createChat(uid: string, firstMessage: string): Promise<string> {
  const ref = collection(db, "users", uid, "chats");
  const docRef = await addDoc(ref, {
    title: titleFromMessage(firstMessage),
    messages: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function saveChatMessages(
  uid: string,
  chatId: string,
  messages: ChatMessage[],
  agentId?: string,
  providerId?: string
) {
  const ref = doc(db, "users", uid, "chats", chatId);
  await updateDoc(ref, {
    messages,
    ...(agentId ? { agentId } : {}),
    ...(providerId ? { providerId } : {}),
    updatedAt: serverTimestamp(),
  });
}