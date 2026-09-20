// lib/taskPlanner.ts
// For tasks that will use real tools (browser/computer), the agent
// drafts a short plan first and the UI shows it for approval — genuine
// tasks needing a Skill or an already-connected Plugin/MCP tool skip
// this and run directly, since those are narrow, well-defined actions.

import { sendChatMessage } from "@/lib/chatClient";

export type TaskPlan = { steps: string[] };

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export async function generateTaskPlan(
  providerId: string,
  apiKey: string,
  task: string,
  toolsSummary: string,
  model?: string
): Promise<TaskPlan | null> {
  const prompt = `You're about to work on this task using real tools: "${task}"\n\nWhat you'll use: ${toolsSummary}\n\nIf the user requested multiple objectives in one prompt, preserve ALL of them and order the dependencies correctly. Write a short plan — 3 to 8 concrete steps — for how you'll approach the complete request. Do not silently drop a subtask. Reply with ONLY raw JSON: {"steps": ["step 1", "step 2", ...]}`;
  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    const parsed = JSON.parse(extractJson(text));
    if (!Array.isArray(parsed?.steps) || parsed.steps.length === 0) return null;
    return { steps: parsed.steps.slice(0, 8) };
  } catch {
    return null;
  }
}