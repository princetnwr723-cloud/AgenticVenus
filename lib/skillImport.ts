// lib/skillImport.ts
// Parses a SKILL.md file's content (YAML-ish frontmatter + markdown
// body) into an importable skill — same shape Anthropic's own Agent
// Skills use: `name` / `description` in frontmatter, instructions as
// the body.

export type ParsedSkill = {
  id: string;
  name: string;
  description: string;
  instructions: string;
};

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

  return { id, name, description, instructions: body.trim().slice(0, 4000) };
}