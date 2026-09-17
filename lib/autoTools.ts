// lib/autoTools.ts
// Before answering, the agent checks the LATEST message against what's
// actually available and decides for itself whether it needs the
// browser, the computer, or is being asked to install a skill from a
// link — no button-pressing required from the user for any of this.

import { sendChatMessage } from "@/lib/chatClient";

export type AutoToolDecision = {
  needsBrowser: boolean;
  needsComputer: boolean;
  installSkillUrl: string | null;
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
  model?: string
): Promise<AutoToolDecision> {
  const none: AutoToolDecision = { needsBrowser: false, needsComputer: false, installSkillUrl: null };
  if (!hasBrowser && !hasComputer) return none;

  const prompt = `Decide what this request needs, based on the latest message:\n"${task}"\n\nAvailable: ${
    hasBrowser ? "a real web browser (browsing, research, reading a specific URL, web scraping, or installing a skill/SKILL.md from a link)" : ""
  }${hasBrowser && hasComputer ? "; " : ""}${
    hasComputer ? "a real cloud desktop computer (for anything needing a full OS or apps, not just a web page)" : ""
  }.\n\nReply with ONLY raw JSON:\n{"needsBrowser": boolean, "needsComputer": boolean, "installSkillUrl": "the exact URL if the user wants a skill installed/learned from a specific link, else null"}`;

  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    const parsed = JSON.parse(extractJson(text));
    return {
      needsBrowser: hasBrowser && !!parsed.needsBrowser,
      needsComputer: hasComputer && !!parsed.needsComputer,
      installSkillUrl:
        typeof parsed.installSkillUrl === "string" && /^https?:\/\//.test(parsed.installSkillUrl)
          ? parsed.installSkillUrl
          : null,
    };
  } catch {
    return none;
  }
}