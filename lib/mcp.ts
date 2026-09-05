// lib/mcp.ts
// Lets a user register an MCP (Model Context Protocol) server so their
// agent can eventually call tools through it. This stores the config only
// — actually speaking the MCP protocol (JSON-RPC over stdio/SSE) needs a
// server-side client, since most MCP servers aren't reachable with a
// plain browser fetch. That wiring is the natural next step once this
// config layer is in place.

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

export type MCPServer = {
  id: string;
  name: string;
  url: string;
  createdAt?: unknown;
};

export async function listMCPServers(uid: string): Promise<MCPServer[]> {
  const ref = collection(db, "users", uid, "mcpServers");
  const q = query(ref, orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, ...d.data() } as MCPServer));
}

export async function addMCPServer(uid: string, name: string, url: string) {
  const ref = collection(db, "users", uid, "mcpServers");
  await addDoc(ref, { name, url, createdAt: serverTimestamp() });
}

export async function deleteMCPServer(uid: string, serverId: string) {
  await deleteDoc(doc(db, "users", uid, "mcpServers", serverId));
}
