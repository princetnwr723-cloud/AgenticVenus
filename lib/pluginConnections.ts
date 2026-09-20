// lib/pluginConnections.ts
import { collection, deleteDoc, doc, getDocs, setDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "@/lib/firebase";
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

/** Wolfram Alpha, Perplexity, Zapier, Make — single-key tools. The key is
 * encrypted server-side; the client never writes it directly to Firestore. */
export async function connectPluginWithApiKey(uid: string, toolId: string, apiKey: string) {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  const res = await fetch("/api/secrets/plugin-key", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ toolId, apiKey }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new Error(data?.error || "Failed to connect.");
  }
}

export async function disconnectPlugin(uid: string, toolId: string) {
  const ref = doc(db, "users", uid, "pluginConnections", toolId);
  await deleteDoc(ref);
}

export function connectedToolNames(connectedIds: string[]): string[] {
  return PLUGIN_TOOLS.filter((t) => connectedIds.includes(t.id)).map((t) => t.name);
}

export function effectiveConnectedToolIds(
  connectedIds: string[],
  mcpServers: { name: string; tools?: { name?: string; description?: string }[] }[]
): string[] {
  const mcpCovered = PLUGIN_TOOLS.filter((t) => {
    const toolId = t.id.toLowerCase();
    const toolName = t.name.toLowerCase();
    return mcpServers.some((s) => {
      const serverName = s.name.toLowerCase();
      const toolText = (s.tools || []).map((x) => `${x.name || ""} ${x.description || ""}`).join(" ").toLowerCase();
      return serverName.includes(toolId) || serverName.includes(toolName) || toolName.includes(serverName) || toolText.includes(toolId) || toolText.includes(toolName);
    });
  }).map((t) => t.id);

  return Array.from(new Set([...connectedIds, ...mcpCovered]));
}