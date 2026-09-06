// lib/pluginConnections.ts
// Tracks which plugins the user has connected, so the agent can know
// what tools it actually has access to. This marks a tool as connected
// in Firestore — it isn't wired to each service's real OAuth flow yet
// (that's the next step for each one individually), but it's what makes
// the rest of the tool-awareness system (detecting a needed tool,
// prompting to connect it, telling the agent what it can use) work today.

import { collection, deleteDoc, doc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { PLUGIN_TOOLS } from "@/lib/plugins";

export async function listConnectedPluginIds(uid: string): Promise<string[]> {
  const ref = collection(db, "users", uid, "pluginConnections");
  const snap = await getDocs(ref);
  return snap.docs.map((d) => d.id);
}

export async function connectPlugin(uid: string, toolId: string) {
  const ref = doc(db, "users", uid, "pluginConnections", toolId);
  await setDoc(ref, { connectedAt: serverTimestamp() });
}

export async function disconnectPlugin(uid: string, toolId: string) {
  const ref = doc(db, "users", uid, "pluginConnections", toolId);
  await deleteDoc(ref);
}

export function connectedToolNames(connectedIds: string[]): string[] {
  return PLUGIN_TOOLS.filter((t) => connectedIds.includes(t.id)).map((t) => t.name);
}