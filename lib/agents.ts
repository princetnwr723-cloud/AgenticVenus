// lib/agents.ts
// The "Agent Team": a set of specialist personas. A lightweight "boss
// agent" call classifies each incoming task and picks the best-fit
// specialist, whose system prompt is then used to answer for real.
//
// Note on "training": there's no model fine-tuning happening here — the
// connected provider's model stays exactly as it is. What we control is
// context: each agent gets its own system prompt, and Business DNA (see
// lib/businessDNA.ts) is layered on top of it. That combination is what
// makes the agent "act like an employee" of the user's business.

import { sendChatMessage, type ChatMessage } from "@/lib/chatClient";

export type Agent = {
  id: string;
  name: string;
  description: string;
  color: string;
  systemPrompt: string;
  isDeveloper?: boolean; // true unlocks the Codespace panel
};

export const AGENT_TEAM: Agent[] = [
  {
    id: "generalist",
    name: "Generalist Agent",
    description: "General questions and everyday tasks.",
    color: "#8A8578",
    systemPrompt:
      "You are a capable general-purpose assistant. Be clear, direct, and helpful.",
  },
  {
    id: "designer",
    name: "Designer Agent",
    description: "Visual design, branding, UI/UX ideas.",
    color: "#D97757",
    systemPrompt:
      "You are a senior product/graphic designer. Think in terms of layout, color, typography, and user experience. Give concrete, visual, actionable design guidance.",
  },
  {
    id: "developer",
    name: "Developer Agent",
    description: "Coding, debugging, and technical builds.",
    color: "#4D6BFE",
    isDeveloper: true,
    systemPrompt:
      "You are a senior software engineer. Write clean, correct, well-commented code. When producing code, always use fenced code blocks with the language and a filename comment on the first line, like ```tsx\n// filename: app/page.tsx so it can be extracted into a file listing.",
  },
  {
    id: "researcher",
    name: "Research Agent",
    description: "Finding, comparing, and summarizing information.",
    color: "#20808D",
    systemPrompt:
      "You are a meticulous research analyst. Structure findings clearly, distinguish facts from opinions, and flag uncertainty honestly.",
  },
  {
    id: "writer",
    name: "Content Writer Agent",
    description: "Copywriting, blog posts, emails, scripts.",
    color: "#5A6B4E",
    systemPrompt:
      "You are a skilled copywriter and content writer. Match tone to purpose, write concisely, and avoid clichés.",
  },
  {
    id: "marketer",
    name: "Marketing Agent",
    description: "Campaigns, positioning, ad and social strategy.",
    color: "#BF5F3F",
    systemPrompt:
      "You are a growth and marketing strategist. Think about audience, channels, messaging, and measurable outcomes.",
  },
  {
    id: "support",
    name: "Support Agent",
    description: "Customer-facing replies, like a helpful employee.",
    color: "#6467F2",
    systemPrompt:
      "You are a warm, professional customer support representative. Resolve the customer's concern clearly and represent the business well.",
  },
];

/** Uses the connected provider itself as the "boss agent" to pick the
 * best-fit specialist for a given task. Falls back to Generalist on any
 * failure so a broken classification never blocks the real reply. */
export async function classifyAgent(
  providerId: string,
  apiKey: string,
  task: string,
  model?: string
): Promise<Agent> {
  const roster = AGENT_TEAM.map((a) => `${a.id}: ${a.description}`).join("\n");
  const classifierPrompt: ChatMessage[] = [
    {
      role: "user",
      content: `You are a routing "boss agent" for a team of specialist AI agents. Given the task below, reply with ONLY the single best agent id from this list, nothing else:\n\n${roster}\n\nTask: "${task}"\n\nAgent id:`,
    },
  ];

  try {
    const reply = await sendChatMessage({
      providerId,
      apiKey,
      messages: classifierPrompt,
      model,
    });
    const normalized = reply.trim().toLowerCase();
    const match = AGENT_TEAM.find((a) => normalized.includes(a.id));
    return match ?? AGENT_TEAM[0];
  } catch {
    return AGENT_TEAM[0];
  }
}

export function getAgentById(id: string): Agent {
  return AGENT_TEAM.find((a) => a.id === id) ?? AGENT_TEAM[0];
}