// lib/errorClassifier.ts
export type ErrorCategory = "network" | "auth" | "rate_limit" | "not_found" | "invalid_input" | "timeout" | "unavailable" | "missing_config" | "unknown";

export type ClassifiedError = {
  category: ErrorCategory;
  retryable: boolean;
  suggestion: string;
};

export function classifyError(message: string): ClassifiedError {
  const m = message.toLowerCase();
  if (/^no_browser|^no_computer/.test(m)) {
    return { category: "missing_config", retryable: false, suggestion: "Add the required API key in Settings → Integrations — retrying won't help without it." };
  }
  if (/timeout|timed out/.test(m)) return { category: "timeout", retryable: true, suggestion: "Retry with a longer wait, or break the task into smaller steps." };
  if (/rate limit|429|too many requests/.test(m)) return { category: "rate_limit", retryable: true, suggestion: "Wait longer before retrying." };
  if (/401|403|unauthorized|forbidden|invalid.*(key|token)|authentication/.test(m)) return { category: "auth", retryable: false, suggestion: "Check that the API key/token is valid and has the right permissions." };
  if (/404|not found/.test(m)) return { category: "not_found", retryable: false, suggestion: "Double-check the URL, ID, or resource name." };
  if (/network|fetch failed|econnrefused|enotfound|failed to fetch/.test(m)) return { category: "network", retryable: true, suggestion: "Retry — likely a transient connectivity issue." };
  if (/unavailable|503|502|bad gateway|service unavailable/.test(m)) return { category: "unavailable", retryable: true, suggestion: "The service is temporarily down — retry after a short wait." };
  if (/invalid|bad request|400|missing required/.test(m)) return { category: "invalid_input", retryable: false, suggestion: "The request itself needs to change, not just be retried." };
  return { category: "unknown", retryable: true, suggestion: "Retry once; if it keeps failing, surface it to the user." };
}