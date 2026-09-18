// lib/chatGroups.ts
// A Group is built by picking 2+ EXISTING chats — they disappear from
// the regular Chats list (marked with mergedGroupId) and appear under a
// new Groups section instead. Inside, every member chat's own agent
// identity can talk with the others in one shared thread.

import { collection, doc, addDoc, deleteDoc, getDoc, getDocs, updateDoc, writeBatch, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { ChatMessage } from "@/lib/chatClient";

export type ChatGroup = {
  id: string;
  name: string;
  chatIds: string[];
};

export async function listChatGroups(uid: string): Promise<ChatGroup[]> {
  const ref = collection(db, "users", uid, "chatGroups");
  const snap = await getDocs(ref);
  return snap.docs.map((d) => ({ id: d.id, name: d.data().name, chatIds: d.data().chatIds || [] }));
}

export async function createChatGroup(uid: string, name: string, chatIds: string[]): Promise<string> {
  const ref = collection(db, "users", uid, "chatGroups");
  const docRef = await addDoc(ref, { name, chatIds, messages: [], createdAt: serverTimestamp() });

  const batch = writeBatch(db);
  for (const chatId of chatIds) {
    batch.update(doc(db, "users", uid, "chats", chatId), { mergedGroupId: docRef.id });
  }
  await batch.commit();

  return docRef.id;
}

export async function deleteChatGroup(uid: string, groupId: string, chatIds: string[]) {
  const batch = writeBatch(db);
  for (const chatId of chatIds) {
    batch.update(doc(db, "users", uid, "chats", chatId), { mergedGroupId: null });
  }
  await batch.commit();
  await deleteDoc(doc(db, "users", uid, "chatGroups", groupId));
}

export async function getChatGroupMessages(uid: string, groupId: string): Promise<(ChatMessage & { agentName?: string; avatarSeed?: string })[]> {
  const snap = await getDoc(doc(db, "users", uid, "chatGroups", groupId));
  return snap.exists() ? (snap.data().messages || []) : [];
}

export async function saveChatGroupMessages(uid: string, groupId: string, messages: (ChatMessage & { agentName?: string; avatarSeed?: string })[]) {
  await updateDoc(doc(db, "users", uid, "chatGroups", groupId), { messages });
}