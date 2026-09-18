// lib/skillImport.ts
// Parses a SKILL.md file's content (YAML-ish frontmatter + markdown
// body) into an importable skill. No hard size rejection — large files
// are trimmed to a safe storage size instead of being refused outright.

export type ParsedSkill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
};

const MAX_INSTRUCTIONS_CHARS = 20_000; // well under Firestore's 1MiB/doc cap

export function parseSkillMd(raw: string): ParsedSkill {
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  let name = "";
  let description = "";
  let body = raw;

  if (fmMatch) {
    const fm = fmMatch[1];
    const nameMatch = fm.match(/^name:\s*(.+)$/im);
    const descMatch = fm.match(/^description:\s*(.+)$/im);
    if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, "");
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, "");
    body = raw.slice(fmMatch[0].length);
  }

  if (!name) {
    const h1 = body.match(/^#\s+(.+)$/m);
    name = h1 ? h1[1].trim() : "Imported Skill";
  }
  if (!description) {
    const firstPara = body
      .split("\n\n")
      .map((p) => p.trim())
      .find((p) => p && !p.startsWith("#"));
    description = firstPara ? firstPara.slice(0, 140) : "Imported from a SKILL.md link.";
  }

  const id =
    "custom-" +
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "custom-skill";

  const trimmed = body.trim();
  const instructions =
    trimmed.length > MAX_INSTRUCTIONS_CHARS
      ? trimmed.slice(0, MAX_INSTRUCTIONS_CHARS) + "\n\n[...trimmed for storage — this skill's file was longer than the stored portion.]"
      : trimmed;

  return { id, name, description, instructions };
}