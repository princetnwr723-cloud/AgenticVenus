import { sendChatMessage } from "@/lib/chatClient";

export type AutoToolDecision = {
  needsBrowser: boolean;
  needsComputer: boolean;
  installSkillUrl: string | null;
  askAgentChatId: string | null;
};

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export async function decideAutoTools(
  providerId: string,
  apiKey: string,
  task: string,
  hasBrowser: boolean,
  hasComputer: boolean,
  connectedAgents: { chatId: string; name: string }[],
  model?: string
): Promise<AutoToolDecision> {
  const none: AutoToolDecision = { needsBrowser: false, needsComputer: false, installSkillUrl: null, askAgentChatId: null };
  if (!hasBrowser && !hasComputer && connectedAgents.length === 0) return none;

  const agentsList = connectedAgents.map((a) => `${a.chatId}: ${a.name}`).join("\n") || "(none)";

  const prompt = `Decide what this request needs, based on the latest message:\n"${task}"\n\nAvailable: ${
    hasBrowser ? "a real web browser (browsing, research, reading a specific URL, web scraping, or installing a skill/SKILL.md from a link)" : ""
  }${hasBrowser && hasComputer ? "; " : ""}${
    hasComputer ? "a real cloud desktop computer (for anything needing a full OS or apps, not just a web page)" : ""
  }.

Connected agents you could ask (chatId: name):
${agentsList}

Reply with ONLY raw JSON:
{"needsBrowser": boolean, "needsComputer": boolean, "installSkillUrl": "exact URL or null", "askAgentChatId": "a chatId from the list above ONLY if the user explicitly wants to consult that named agent, else null"}`;

  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    const parsed = JSON.parse(extractJson(text));
    return {
      needsBrowser: hasBrowser && !!parsed.needsBrowser,
      needsComputer: hasComputer && !!parsed.needsComputer,
      installSkillUrl: typeof parsed.installSkillUrl === "string" && /^https?:\/\//.test(parsed.installSkillUrl) ? parsed.installSkillUrl : null,
      askAgentChatId:
        typeof parsed.askAgentChatId === "string" && connectedAgents.some((a) => a.chatId === parsed.askAgentChatId)
          ? parsed.askAgentChatId
          : null,
    };
  } catch {
    return none;
  }
}