// lib/groupOrchestrator.ts
// Runs a Group as a real little team: each agent sees what teammates
// before it said and adds its own specialist contribution; a final
// synthesis turn combines everything into one coherent answer.

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";
import { getAgentById } from "@/lib/agents";
import type { AgentGroup } from "@/lib/agentGroups";

export type GroupTurn = {
  agentId: string;
  agentName: string;
  color: string;
  content: string;
};

export async function runAgentGroup(
  providerId: string,
  apiKey: string,
  group: AgentGroup,
  task: string,
  priorMessages: ChatMessage[],
  model?: string
): Promise<{ turns: GroupTurn[]; finalAnswer: string }> {
  const turns: GroupTurn[] = [];
  const recentContext = priorMessages
    .slice(-6)
    .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content}`)
    .join("\n");

  for (const agentId of group.agentIds) {
    const agent = getAgentById(agentId);
    const soFar = turns.length
      ? turns.map((t) => `[${t.agentName}]: ${t.content}`).join("\n\n")
      : "(nothing yet — you're going first)";
    const prompt = `${agent.systemPrompt}

You're one specialist on a small team working together on this task. Recent conversation:
${recentContext}

Task: "${task}"

Teammates' contributions so far:
${soFar}

Give YOUR contribution as the ${agent.name} — focused on your specialty, building on what teammates already said rather than repeating it. Keep it to a focused paragraph or short list.`;

    try {
      const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
      turns.push({ agentId, agentName: agent.name, color: agent.color, content: text });
    } catch {
      // A single specialist failing shouldn't sink the whole group.
    }
  }

  const synthesisPrompt = `A team just worked on this task: "${task}"

Their contributions:
${turns.map((t) => `[${t.agentName}]: ${t.content}`).join("\n\n")}

Write ONE clear, well-organized final answer for the user that combines the team's work into a single coherent response. Don't just concatenate — synthesize.`;

  let finalAnswer = turns.map((t) => t.content).join("\n\n");
  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: synthesisPrompt }] });
    finalAnswer = text;
  } catch {
    // Fall back to the raw concatenation above.
  }

  return { turns, finalAnswer };
}