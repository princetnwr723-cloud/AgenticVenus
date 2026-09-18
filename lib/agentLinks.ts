import { collection, doc, addDoc, deleteDoc, getDocs, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";

export type AgentConnection = {
  id: string;
  sourceChatId: string;
  targetChatIds: string[];
};

export async function listAgentConnections(uid: string): Promise<AgentConnection[]> {
  const ref = collection(db, "users", uid, "agentConnections");
  const snap = await getDocs(ref);
  return snap.docs.map((d) => ({ id: d.id, sourceChatId: d.data().sourceChatId, targetChatIds: d.data().targetChatIds || [] }));
}

export async function createAgentConnection(uid: string, sourceChatId: string, targetChatIds: string[]): Promise<string> {
  const ref = collection(db, "users", uid, "agentConnections");
  const docRef = await addDoc(ref, { sourceChatId, targetChatIds, createdAt: serverTimestamp() });
  return docRef.id;
}

export async function deleteAgentConnection(uid: string, connectionId: string) {
  await deleteDoc(doc(db, "users", uid, "agentConnections", connectionId));
}