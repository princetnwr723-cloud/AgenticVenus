// lib/recoveryEngine.ts
// Generic "try, classify failure, retry with backoff, give up safely"
// wrapper — used for browser/computer actions, mission subtasks, and
// anything else that hits a real external system. A per-key circuit
// breaker stops retrying something that's clearly broken (e.g. a bad
// API key) instead of burning attempts/resources indefinitely.

import { classifyError, type ClassifiedError } from "@/lib/errorClassifier";

const BACKOFF_MS = [1000, 3000, 8000];
const CIRCUIT_WINDOW_MS = 5 * 60 * 1000;
const CIRCUIT_THRESHOLD = 5;

const failureLog: Record<string, number[]> = {};

function circuitOpen(key: string): boolean {
  const now = Date.now();
  const log = (failureLog[key] || []).filter((t) => now - t < CIRCUIT_WINDOW_MS);
  failureLog[key] = log;
  return log.length >= CIRCUIT_THRESHOLD;
}

function recordFailure(key: string) {
  failureLog[key] = [...(failureLog[key] || []), Date.now()];
}

export type RecoveryResult<T> =
  | { ok: true; value: T; attempts: number }
  | { ok: false; error: ClassifiedError; attempts: number; rawMessage: string };

export async function withRecovery<T>(key: string, fn: () => Promise<T>, maxAttempts = 3): Promise<RecoveryResult<T>> {
  if (circuitOpen(key)) {
    return {
      ok: false,
      attempts: 0,
      rawMessage: "Too many recent failures for this — pausing to avoid wasting resources. Try again in a few minutes.",
      error: { category: "unavailable", retryable: false, suggestion: "Wait before retrying, or check what's misconfigured." },
    };
  }

  let lastMessage = "";
  let lastClassified: ClassifiedError = { category: "unknown", retryable: true, suggestion: "" };

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const value = await fn();
      return { ok: true, value, attempts: attempt };
    } catch (err) {
      lastMessage = err instanceof Error ? err.message : "unknown error";
      lastClassified = classifyError(lastMessage);
      recordFailure(key);
      if (!lastClassified.retryable || attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] || 8000));
    }
  }

  return { ok: false, error: lastClassified, attempts: maxAttempts, rawMessage: lastMessage };
}