"use client";

// components/SkillsPanel.tsx
// Browse and install skills — catalog ones, or imported from a SKILL.md
// link. Custom skills can be expanded to see the full stored content,
// so you can verify exactly what the agent will follow.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { SKILL_CATEGORIES, SKILLS_CATALOG, type Skill } from "@/lib/skills";
import { installSkill, uninstallSkill, listInstalledSkillIds } from "@/lib/skillConnections";
import { listCustomSkills, saveCustomSkill, deleteCustomSkill } from "@/lib/customSkills";
import { importSkillFromUrl } from "@/lib/skillImportClient";
import { getUserPlanId } from "@/lib/userPlan";
import { getPlan } from "@/lib/plans";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  onInstalledChange?: (ids: string[]) => void;
  onCustomSkillsChange?: (skills: Skill[]) => void;
  onUpgrade: () => void;
};

export default function SkillsPanel({ uid, open, onClose, onInstalledChange, onCustomSkillsChange, onUpgrade }: Props) {
  const [installed, setInstalled] = useState<string[]>([]);
  const [customSkills, setCustomSkills] = useState<Skill[]>([]);
  const [maxSkills, setMaxSkills] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const totalInstalled = installed.length + customSkills.length;

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [ids, custom, planId] = await Promise.all([
        listInstalledSkillIds(uid),
        listCustomSkills(uid),
        getUserPlanId(uid),
      ]);
      setInstalled(ids);
      setCustomSkills(custom);
      setMaxSkills(getPlan(planId).maxSkills);
      setLoading(false);
    })();
  }, [open, uid]);

  async function toggle(skillId: string) {
    const isInstalled = installed.includes(skillId);
    if (!isInstalled && totalInstalled >= maxSkills) {
      onUpgrade();
      return;
    }
    setBusyId(skillId);
    if (isInstalled) {
      await uninstallSkill(uid, skillId);
      const next = installed.filter((id) => id !== skillId);
      setInstalled(next);
      onInstalledChange?.(next);
    } else {
      await installSkill(uid, skillId);
      const next = [...installed, skillId];
      setInstalled(next);
      onInstalledChange?.(next);
    }
    setBusyId(null);
  }

  async function handleImport() {
    if (!importUrl.trim()) return;
    if (totalInstalled >= maxSkills) {
      onUpgrade();
      return;
    }
    setImporting(true);
    setImportError(null);
    try {
      const parsed = await importSkillFromUrl(importUrl.trim());
      const skill: Skill = {
        id: parsed.id,
        name: parsed.name,
        category: "writing",
        description: parsed.description,
        color: "#8A8578",
        instructions: parsed.instructions,
      };
      await saveCustomSkill(uid, skill, importUrl.trim());
      const next = [...customSkills.filter((s) => s.id !== skill.id), skill];
      setCustomSkills(next);
      onCustomSkillsChange?.(next);
      setImportUrl("");
      setExpandedId(skill.id);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import that skill.");
    } finally {
      setImporting(false);
    }
  }

  async function handleRemoveCustom(skillId: string) {
    setBusyId(skillId);
    await deleteCustomSkill(uid, skillId);
    const next = customSkills.filter((s) => s.id !== skillId);
    setCustomSkills(next);
    onCustomSkillsChange?.(next);
    if (expandedId === skillId) setExpandedId(null);
    setBusyId(null);
  }

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Skills"
      subtitle={`${totalInstalled} of ${maxSkills} installed on your plan.`}
    >
      <div className="mb-8">
        <h3 className="text-sm font-medium text-ink">Import from a link</h3>
        <p className="mt-0.5 text-xs text-ink/50">
          Paste a SKILL.md URL (GitHub blob links work too) to install it as a custom skill.
        </p>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={importUrl}
            onChange={(e) => setImportUrl(e.target.value)}
            placeholder="https://github.com/.../SKILL.md"
            className="focus-ring flex-1 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none"
          />
          <button
            onClick={handleImport}
            disabled={!importUrl.trim() || importing}
            className="focus-ring shrink-0 rounded-md bg-clay px-3 py-2 text-xs font-medium text-cream transition-colors hover:bg-clay-dark disabled:opacity-50"
          >
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
        {importError && <p className="mt-1.5 text-xs text-red-600">{importError}</p>}

        {customSkills.length > 0 && (
          <div className="mt-3 space-y-2">
            {customSkills.map((skill) => {
              const isExpanded = expandedId === skill.id;
              return (
                <div key={skill.id} className="rounded-md border border-ink/10 bg-white">
                  <div className="flex items-center gap-3 px-3 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-sand text-xs font-semibold text-ink/70">
                      {skill.name.charAt(0)}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-ink">{skill.name}</p>
                      <p className="text-xs text-ink/50">{skill.description}</p>
                    </div>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : skill.id)}
                      className="shrink-0 rounded-md border border-ink/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition-colors hover:bg-sand hover:text-ink"
                    >
                      {isExpanded ? "Hide" : "View"}
                    </button>
                    <button
                      onClick={() => handleRemoveCustom(skill.id)}
                      disabled={busyId === skill.id}
                      className="shrink-0 rounded-md border border-ink/10 px-3 py-1.5 text-xs font-medium text-ink/60 transition-colors hover:bg-sand hover:text-red-600 disabled:opacity-50"
                    >
                      {busyId === skill.id ? "..." : "Remove"}
                    </button>
                  </div>
                  {isExpanded && (
                    <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-ink/10 bg-sand/40 px-3 py-2.5 text-xs text-ink/75">
                      {skill.instructions}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-8">
        {SKILL_CATEGORIES.map((cat) => (
          <div key={cat.id}>
            <h3 className="text-sm font-medium text-ink">{cat.label}</h3>
            <div className="mt-3 space-y-2">
              {SKILLS_CATALOG.filter((s) => s.category === cat.id).map((skill) => {
                const isInstalled = installed.includes(skill.id);
                return (
                  <div
                    key={skill.id}
                    className="flex items-center gap-3 rounded-md border border-ink/10 bg-white px-3 py-2.5 transition-all hover:-translate-y-0.5 hover:shadow-sm"
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white"
                      style={{ backgroundColor: skill.color }}
                    >
                      {skill.name.charAt(0)}
                    </span>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-ink">{skill.name}</p>
                      <p className="text-xs text-ink/50">{skill.description}</p>
                    </div>
                    <button
                      onClick={() => toggle(skill.id)}
                      disabled={loading || busyId === skill.id}
                      className={`shrink-0 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        isInstalled
                          ? "border-moss/30 bg-moss/10 text-moss hover:bg-moss/20"
                          : "border-ink/10 text-ink/60 hover:bg-sand hover:text-ink"
                      }`}
                    >
                      {busyId === skill.id ? "..." : isInstalled ? "Installed ✓" : "Install"}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {totalInstalled >= maxSkills && (
        <button
          onClick={onUpgrade}
          className="focus-ring mt-6 w-full rounded-md bg-clay px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark"
        >
          Upgrade for more skills
        </button>
      )}
    </SlideOverPanel>
  );
}