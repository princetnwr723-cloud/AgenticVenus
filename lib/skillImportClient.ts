import { auth } from "@/lib/firebase";
import type { ParsedSkill } from "@/lib/skillImport";

export async function importSkillFromUrl(url: string): Promise<ParsedSkill> {
  const idToken = await auth.currentUser?.getIdToken();
  if (!idToken) throw new Error("Not signed in.");
  const res = await fetch("/api/skills/import", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ url }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error || "Failed to import skill.");
  return data as ParsedSkill;
}