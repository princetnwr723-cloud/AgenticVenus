// lib/autoTools.ts
// CRITICAL FIX: this used to silently return needsBrowser=false whenever
// a Browserless key wasn't configured — even if the task genuinely
// needed one — so the agent had no idea it was missing a capability and
// would just guess/hallucinate an answer instead. Now it always asks
// what the task WANTS first, then separately flags "wanted but not
// configured" so the caller can make the agent say so honestly.

import { sendChatMessage } from "@/lib/chatClient";

export type AutoToolDecision = {
  needsBrowser: boolean;
  needsComputer: boolean;
  browserUnavailable: boolean; // task wants browsing but no key is configured
  computerUnavailable: boolean;
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
  const none: AutoToolDecision = { needsBrowser: false, needsComputer: false, browserUnavailable: false, computerUnavailable: false, installSkillUrl: null, askAgentChatId: null };

  const agentsList = connectedAgents.map((a) => `${a.chatId}: ${a.name}`).join("\n") || "(none)";

  const prompt = `Decide what this request genuinely needs to be done FOR REAL — based on what the task NEEDS, not on what happens to be configured right now:
"${task}"

Does it need real web browsing (visiting live sites, scraping data, reading a specific URL, current research, installing a skill from a link)?
Does it need a real cloud desktop computer (running software, a full OS, apps)?

Connected agents you could ask (chatId: name):
${agentsList}

Reply with ONLY raw JSON:
{"wantsBrowser": boolean, "wantsComputer": boolean, "installSkillUrl": "exact URL or null", "askAgentChatId": "a chatId from the list above ONLY if the user explicitly wants to consult that named agent, else null"}`;

  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    const parsed = JSON.parse(extractJson(text));
    const wantsBrowser = !!parsed.wantsBrowser;
    const wantsComputer = !!parsed.wantsComputer;
    return {
      needsBrowser: hasBrowser && wantsBrowser,
      needsComputer: hasComputer && wantsComputer,
      browserUnavailable: wantsBrowser && !hasBrowser,
      computerUnavailable: wantsComputer && !hasComputer,
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