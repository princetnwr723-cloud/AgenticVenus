// lib/agentJson.ts
// Models often wrap JSON in prose or code fences, or add a sentence after it.
// A plain JSON.parse() then throws and the whole agent loop dies. This finds
// the first complete JSON object in the text instead.

function tryParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function firstBalancedObject(s: string): string | null {
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  return null;
}

export function parseFirstJson<T = any>(text: string | undefined | null): T | null {
  if (!text) return null;
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidates = [fenced?.[1], text].filter((c): c is string => !!c);
  for (const candidate of candidates) {
    const direct = tryParse(candidate.trim());
    if (direct !== null) return direct as T;
    const slice = firstBalancedObject(candidate);
    if (slice) {
      const parsed = tryParse(slice);
      if (parsed !== null) return parsed as T;
    }
  }
  return null;
}