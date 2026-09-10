// lib/skills.ts
// A catalog of installable "skills" — each one is a focused instruction
// set that gets folded into the agent's system prompt once installed,
// the same way Anthropic's own Agent Skills work: a skill is just
// well-written, reusable instructions for doing one kind of task really
// well, not a separate model or a plugin connection.

export type SkillCategory = "writing" | "coding" | "business" | "design" | "data";

export type Skill = {
  id: string;
  name: string;
  category: SkillCategory;
  description: string;
  color: string;
  instructions: string;
};

export const SKILL_CATEGORIES: { id: SkillCategory; label: string }[] = [
  { id: "writing", label: "Writing" },
  { id: "coding", label: "Coding" },
  { id: "business", label: "Business" },
  { id: "design", label: "Design" },
  { id: "data", label: "Data" },
];

export const SKILLS_CATALOG: Skill[] = [
  {
    id: "seo-writer",
    name: "SEO Writer",
    category: "writing",
    description: "Writes content structured and worded to rank well.",
    color: "#5A6B4E",
    instructions:
      "When writing content, apply SEO best practice: a clear H1 matching search intent, a compelling meta-description-length summary up top, natural keyword placement (never stuffed), short scannable paragraphs, and descriptive subheadings every 150-250 words.",
  },
  {
    id: "copy-editor",
    name: "Copy Editor",
    category: "writing",
    description: "Tightens and polishes writing like a professional editor.",
    color: "#8A8578",
    instructions:
      "When editing or reviewing text, cut filler words, prefer active voice, vary sentence length for rhythm, and flag (don't silently fix) anything that changes the author's meaning. Explain edits briefly when asked.",
  },
  {
    id: "code-reviewer",
    name: "Code Reviewer",
    category: "coding",
    description: "Reviews code like a strict senior engineer.",
    color: "#4D6BFE",
    instructions:
      "When reviewing code, check for: correctness and edge cases, security issues (injection, auth, secrets), readability, and unnecessary complexity. Structure feedback as: critical issues first, then suggestions, then nitpicks. Always explain *why*, not just *what*.",
  },
  {
    id: "test-writer",
    name: "Test Writer",
    category: "coding",
    description: "Writes thorough unit tests alongside code.",
    color: "#20808D",
    instructions:
      "When writing code, also offer tests covering the happy path, edge cases (empty/null/boundary values), and at least one failure case. Use the testing convention already present in the project if one is visible, otherwise a sensible default for the language.",
  },
  {
    id: "sales-closer",
    name: "Sales Closer",
    category: "business",
    description: "Writes outreach and follow-ups that convert.",
    color: "#BF5F3F",
    instructions:
      "When writing sales or outreach messages, lead with the recipient's problem, not your product. Keep it under 150 words, end with one specific, low-friction call to action, and avoid generic flattery or hype language.",
  },
  {
    id: "financial-analyst",
    name: "Financial Analyst",
    category: "data",
    description: "Reasons carefully about numbers and financial claims.",
    color: "#D97757",
    instructions:
      "When discussing financial figures, always state assumptions explicitly, distinguish nominal from real/inflation-adjusted figures when relevant, show the calculation rather than just the answer, and flag when a claim needs a source.",
  },
  {
    id: "ui-critic",
    name: "UI Critic",
    category: "design",
    description: "Gives concrete, actionable design feedback.",
    color: "#6467F2",
    instructions:
      "When reviewing a UI or design, organize feedback by: hierarchy/clarity, spacing/alignment, color/contrast (including accessibility), and copy. Give specific fixes (exact spacing values, specific color, exact wording) rather than vague notes like 'improve spacing'.",
  },
  {
    id: "data-storyteller",
    name: "Data Storyteller",
    category: "data",
    description: "Turns raw data into a clear narrative.",
    color: "#00A1E0",
    instructions:
      "When presenting data or analysis, lead with the single most important takeaway in one sentence, then support it with 2-3 supporting numbers, then caveats. Avoid dumping raw tables when a short summary answers the question.",
  },
];

export function getSkillById(id: string): Skill | undefined {
  return SKILLS_CATALOG.find((s) => s.id === id);
}