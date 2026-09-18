// lib/agentLinkOrchestrator.ts
// Lets THIS chat's agent ask a connected chat's agent something for
// real — it reads that other chat's own recent history + identity, and
// answers as itself, so the reply genuinely reflects that agent.

import { sendChatMessage } from "@/lib/chatClient";
import { getChat } from "@/lib/chats";
import { getAgentIdentity } from "@/lib/agentIdentity";

export async function askConnectedAgent(
  uid: string,
  providerId: string,
  apiKey: string,
  targetChatId: string,
  question: string,
  model?: string
): Promise<string> {
  const [chat, identity] = await Promise.all([getChat(uid, targetChatId), getAgentIdentity(uid, targetChatId)]);
  if (!chat) throw new Error("Connected chat not found.");

  const context = chat.messages
    .slice(-10)
    .map((m) => `${m.role === "user" ? "User" : identity.name}: ${m.content}`)
    .join("\n");

  const prompt = `You are ${identity.name}, an AI agent with your own ongoing conversation. ${
    identity.customPrompt ? identity.customPrompt + " " : ""
  }Recent context from your own conversation:\n${context}\n\nAnother agent is asking you: "${question}"\n\nAnswer helpfully and concisely, as yourself.`;

  const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
  return text;
}