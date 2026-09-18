// lib/agentIdentity.ts
// Every chat gets a persistent identity — a default name and animated
// avatar assigned deterministically from the chat's own id (so it's
// stable without an extra write), until the user customizes it. Tapping
// the name in the chat header opens AgentSettingsModal to change any of
// this, including adding extra "custom instructions" layered on top of
// whatever specialist the boss agent picks.

import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type AgentIdentity = {
  name: string;
  avatarSeed: string;
  customPrompt?: string;
};

const DEFAULT_NAMES = [
  "Nova", "Orion", "Sable", "Juno", "Atlas", "Iris", "Kai", "Lyra", "Zephyr", "Rhea",
  "Cato", "Vela", "Indra", "Sol", "Nyx", "Echo", "Finn", "Bree", "Talon", "Wren",
  "Onyx", "Cyra", "Rune", "Fable", "Moss", "Sage", "Ren", "Vale", "Ash", "Kestrel",
];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

export function defaultIdentityForChat(chatId: string): AgentIdentity {
  const h = hashSeed(chatId);
  return { name: DEFAULT_NAMES[h % DEFAULT_NAMES.length], avatarSeed: `a${(h % 54) + 1}` };
}

export async function getAgentIdentity(uid: string, chatId: string): Promise<AgentIdentity> {
  const ref = doc(db, "users", uid, "chats", chatId);
  const snap = await getDoc(ref);
  const stored = snap.exists() ? (snap.data().agentIdentity as AgentIdentity | undefined) : undefined;
  return stored || defaultIdentityForChat(chatId);
}

export async function saveAgentIdentity(uid: string, chatId: string, identity: AgentIdentity) {
  const ref = doc(db, "users", uid, "chats", chatId);
  await setDoc(ref, { agentIdentity: identity }, { merge: true });
}