// lib/mcp.ts
// Saves MCP server configs (name, URL, optional auth header, and the
// tools actually discovered on it) so the agent knows what real
// capabilities it has beyond the built-in plugins.

import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import type { MCPToolInfo } from "@/lib/mcpClient";

export type MCPServer = {
  id: string;
  name: string;
  url: string;
  authHeader?: string;
  tools?: MCPToolInfo[];
  createdAt?: unknown;
};

export async function listMCPServers(uid: string): Promise<MCPServer[]> {
  const ref = collection(db, "users", uid, "mcpServers");
  const q = query(ref, orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MCPServer));
}

export async function addMCPServer(
  uid: string,
  name: string,
  url: string,
  authHeader?: string,
  tools?: MCPToolInfo[]
) {
  const ref = collection(db, "users", uid, "mcpServers");
  await addDoc(ref, {
    name,
    url,
    ...(authHeader ? { authHeader } : {}),
    tools: tools || [],
    createdAt: serverTimestamp(),
  });
}

export async function deleteMCPServer(uid: string, serverId: string) {
  await deleteDoc(doc(db, "users", uid, "mcpServers", serverId));
}