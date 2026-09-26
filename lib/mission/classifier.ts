// lib/mission/classifier.ts
// Cheap, regex-first check for "does this need a small team of agents
// working in parallel", so a normal chat message never pays for a planning
// call. Only when this heuristic says "maybe" does the caller invoke the
// real planner (lib/mission/planner.ts) — and even then, if the plan comes
// back as a single simple task, the caller treats it as an ordinary message
// instead of opening the mission flow.

const DELIVERABLES = [
  /\bwebsite|web\s?app|landing\s?page|app\b/i,
  /\bleads?\b/i,
  /\b(email|outreach|message)\s+(them|everyone|leads)/i,
  /\bbook(ing)?\s+(a\s+)?(call|meeting|deal)/i,
  /\bresearch\b.*\band\b.*\b(build|create|write)/i,
  /\bfind\b.*\band\b/i,
];

const CONNECTORS = /\b(and then|after that|once (that|it)'?s? done|and also|as well as)\b/i;

export function looksLikeMissionTask(task: string): boolean {
  const text = task.trim();
  if (text.length < 25) return false;
  const hits = DELIVERABLES.filter((re) => re.test(text)).length;
  if (hits >= 2) return true;
  return hits >= 1 && CONNECTORS.test(text);
}