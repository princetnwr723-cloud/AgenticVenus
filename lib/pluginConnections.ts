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

/** For the handful of plugins that just need a pasted key/token (Wolfram
 * Alpha, Perplexity, Zapier, Make) rather than a full OAuth login. */
export async function connectPluginWithApiKey(uid: string, toolId: string, apiKey: string) {
  const ref = doc(db, "users", uid, "pluginConnections", toolId);
  await setDoc(ref, { apiKey, connectedAt: serverTimestamp() });
}

export async function disconnectPlugin(uid: string, toolId: string) {
  const ref = doc(db, "users", uid, "pluginConnections", toolId);
  await deleteDoc(ref);
}

export function connectedToolNames(connectedIds: string[]): string[] {
  return PLUGIN_TOOLS.filter((t) => connectedIds.includes(t.id)).map((t) => t.name);
}

/** A plugin should count as "connected" if either its own toggle is on,
 * OR the user already has a real MCP server connected whose name matches
 * it (e.g. an MCP server literally named "Gmail" covers the Gmail
 * plugin). This is what makes the tool-awareness system recognize a
 * Gmail MCP connection instead of asking to "connect Gmail in Plugins"
 * when it's already working through MCP. */
export function effectiveConnectedToolIds(
  connectedIds: string[],
  mcpServers: { name: string }[]
): string[] {
  const mcpCovered = PLUGIN_TOOLS.filter((t) => {
    const toolId = t.id.toLowerCase();
    const toolName = t.name.toLowerCase();
    return mcpServers.some((s) => {
      const serverName = s.name.toLowerCase();
      return serverName.includes(toolId) || serverName.includes(toolName) || toolName.includes(serverName);
    });
  }).map((t) => t.id);

  return Array.from(new Set([...connectedIds, ...mcpCovered]));
}