// lib/mcp.ts
// Saves MCP server configs — including which auth style each one needs
// (none / API key / full OAuth) and, for OAuth servers, the access and
// refresh tokens obtained through the real "Continue to X" login flow
// (see lib/mcpOAuth.ts and the /api/mcp/oauth/* routes).

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

export type MCPAuthType = "none" | "apikey" | "oauth";

export type MCPOAuthTokens = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  tokenEndpoint: string;
  clientId: string;
  redirectUri: string;
};

export type MCPServer = {
  id: string;
  name: string;
  url: string;
  authType: MCPAuthType;
  apiKeyHeader?: string;
  oauth?: MCPOAuthTokens;
  tools?: MCPToolInfo[];
  createdAt?: unknown;
};

export async function listMCPServers(uid: string): Promise<MCPServer[]> {
  const ref = collection(db, "users", uid, "mcpServers");
  const q = query(ref, orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, authType: "none", ...d.data() } as MCPServer));
}

export async function addMCPServer(
  uid: string,
  name: string,
  url: string,
  authType: MCPAuthType,
  apiKeyHeader?: string,
  tools?: MCPToolInfo[]
): Promise<string> {
  const ref = collection(db, "users", uid, "mcpServers");
  const docRef = await addDoc(ref, {
    name,
    url,
    authType,
    ...(apiKeyHeader ? { apiKeyHeader } : {}),
    tools: tools || [],
    createdAt: serverTimestamp(),
  });
  return docRef.id;
}

export async function deleteMCPServer(uid: string, serverId: string) {
  await deleteDoc(doc(db, "users", uid, "mcpServers", serverId));
}