// lib/skillHub.ts
// "Install any skill" made real without inventing links: category prompts
// the person can search, using the already-working web-search plugin action
// to find real public SKILL.md files. Results still go through the SAME
// import-and-parse flow as pasting a link (lib/skillImportClient.ts), so
// nothing gets installed without being fetched and parsed for real — the
// list here never claims a skill exists until the search actually finds it.

export const SKILL_HUB_CATEGORIES = [
  "landing pages that convert",
  "SEO writing",
  "cold outreach emails",
  "pitch decks",
  "data visualization",
  "brand voice and copywriting",
  "3D / Three.js scenes",
  "growth experiments",
];

export type SkillHubResult = { title: string; url: string; snippet: string };

/** Parses the plain-text lib/pluginActions.ts's web-search.search returns
 * ("1. Title\n   url\n   snippet") into structured hits, keeping only ones
 * that plausibly point at an actual SKILL.md file. */
export function parseSkillSearchResults(raw: string): SkillHubResult[] {
  const out: SkillHubResult[] = [];
  const blocks = raw.split(/\n(?=\d+\.\s)/);
  for (const block of blocks) {
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    const title = lines[0]?.replace(/^\d+\.\s*/, "");
    const url = lines.find((l) => /^https?:\/\//i.test(l));
    if (!title || !url) continue;
    out.push({ title, url, snippet: lines.slice(2).join(" ").slice(0, 160) });
  }
  return out.filter((r) => /skill\.md/i.test(r.url) || /skill/i.test(r.title));
}