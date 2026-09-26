// lib/verification.ts
import { sendChatMessage } from "@/lib/chatClient";

function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

export type VerificationResult = { verified: boolean; reason: string };

/** LLM-based check: did this genuinely accomplish what it claims, or
 * does the outcome look like a guess / a failure described as success? */
export async function verifyTaskResult(
  providerId: string, apiKey: string, description: string, outcome: string, model?: string
): Promise<VerificationResult> {
  const prompt = `Task: "${description}"\nOutcome reported: "${outcome.slice(0, 1500)}"\n\nWas this genuinely accomplished, or does it look incomplete/guessed/a failure described as success? Reply with ONLY raw JSON: {"verified": boolean, "reason": "one short sentence"}`;
  try {
    const { text } = await sendChatMessage({ providerId, apiKey, model, messages: [{ role: "user", content: prompt }] });
    const parsed = JSON.parse(extractJson(text));
    return { verified: !!parsed.verified, reason: parsed.reason || "" };
  } catch (err) {
    return { verified: false, reason: `Verification could not be completed: ${err instanceof Error ? err.message : "unknown error"}.` };
  }
}

/** Real (non-LLM) check for a published URL — fetches it for real. A
 * fresh Vercel/Netlify deploy can take a few seconds to propagate, so
 * this retries briefly before concluding it's actually broken. */
export async function verifyPublishedUrl(url: string, attempts = 4, delayMs = 3000): Promise<VerificationResult> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url, { method: "GET", redirect: "follow" });
      if (res.ok) return { verified: true, reason: `Responded with ${res.status}.` };
      if ((res.status >= 500 || res.status === 404) && i < attempts - 1) {
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      return { verified: false, reason: `Responded with ${res.status}.` };
    } catch {
      if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return { verified: false, reason: "Didn't respond successfully after several attempts." };
}