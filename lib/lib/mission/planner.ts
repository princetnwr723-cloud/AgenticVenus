// lib/mission/planner.ts
import { sendChatMessage } from "@/lib/chatClient";
import { parseFirstJson } from "@/lib/agentJson";
import type { MissionTask, MissionTaskRole } from "@/lib/mission/types";

const ROLES: MissionTaskRole[] = ["research", "build", "leadgen", "outreach", "watcher", "report", "generic"];

export async function planMission(providerId: string, apiKey: string, goal: string, model?: string): Promise<MissionTask[]> {
  const prompt = `Break this goal into a small team's task graph. Roles available: research (browse the web to gather facts), build (build/fix a real website or app in the cloud workspace), leadgen (search the web for potential customers/leads and list them), outreach (draft/send emails or messages to leads), watcher (periodically check for replies and book meetings/deals), report (write the final summary for the user), generic (anything else, handled by a general specialist).

Rules:
- Independent parts of the goal (e.g. building a website and finding leads) should be SEPARATE tasks with no dependency on each other, so they can run in parallel.
- A task that needs another task's output (e.g. emailing leads needs both the built website's link and the lead list) must depend on both.
- Always end with exactly one "report" task that depends on everything meaningful, so the user gets one final summary.
- Only add a "watcher" task if the goal explicitly involves waiting for replies, follow-ups, or booking meetings.
- 3 to 8 tasks total. Keep titles short and concrete (what to actually do), not vague.

Goal: "${goal}"

Reply with ONLY raw JSON: {"tasks":[{"id":"t1","title":"...","role":"build","dependsOn":[]}, ...]}`;

  const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
  const parsed = parseFirstJson<{ tasks?: any[] }>(text);
  const raw = Array.isArray(parsed?.tasks) ? parsed!.tasks! : [];
  const now = Date.now();
  const ids = new Set(raw.map((t) => String(t.id)));
  const tasks: MissionTask[] = raw
    .filter((t) => t && t.id && t.title)
    .map((t) => ({
      id: String(t.id),
      title: String(t.title).slice(0, 200),
      role: ROLES.includes(t.role) ? t.role : "generic",
      dependsOn: Array.isArray(t.dependsOn) ? t.dependsOn.filter((d: any) => ids.has(String(d))).map(String) : [],
      status: "pending" as const,
      createdAt: now,
      updatedAt: now,
    }));

  if (!tasks.length) {
    // Fallback: a single generic task rather than a mission that can never run.
    return [{ id: "t1", title: goal.slice(0, 200), role: "generic", dependsOn: [], status: "pending", createdAt: now, updatedAt: now }];
  }
  if (!tasks.some((t) => t.role === "report")) {
    tasks.push({ id: "report", title: "Summarize everything for the user", role: "report", dependsOn: tasks.map((t) => t.id), status: "pending", createdAt: now, updatedAt: now });
  }
  return tasks;
}