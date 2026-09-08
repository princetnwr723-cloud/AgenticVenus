// lib/scheduleDetect.ts
// When the user asks for something recurring or time-based ("give me AI
// news daily at 10am"), the boss agent should set that up in the
// Scheduler itself instead of just answering once. This uses the
// connected provider as a lightweight classifier to detect that intent
// and pull out the task + time + recurrence.

import { sendChatMessage } from "@/lib/chatClient";

export type ScheduleIntent = {
  taskMessage: string;
  time: string; // "HH:MM", 24-hour
  recurrence: "once" | "hourly" | "daily";
};

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export async function detectScheduleIntent(
  providerId: string,
  apiKey: string,
  userMessage: string,
  model?: string
): Promise<ScheduleIntent | null> {
  const prompt = `Decide if this message is asking to schedule something for a future/recurring time (e.g. "send me AI news daily at 10am", "remind me to check email every morning at 9", "email me a summary tomorrow at 6pm").

Message: "${userMessage}"

Reply with ONLY raw JSON, no other text, in exactly this shape:
{"isSchedule": boolean, "taskMessage": string, "time": "HH:MM" in 24-hour format, "recurrence": "once", "hourly", or "daily"}

If it is not a scheduling request, reply {"isSchedule": false, "taskMessage": "", "time": "", "recurrence": "once"}.`;

  try {
    const { text } = await sendChatMessage({
      providerId,
      apiKey,
      messages: [{ role: "user", content: prompt }],
      model,
    });
    const parsed = JSON.parse(extractJson(text));
    if (!parsed?.isSchedule || !parsed?.time) return null;
    return {
      taskMessage: parsed.taskMessage || userMessage,
      time: parsed.time,
      recurrence: parsed.recurrence === "daily" ? "daily" : parsed.recurrence === "hourly" ? "hourly" : "once",
    };
  } catch {
    return null;
  }
}