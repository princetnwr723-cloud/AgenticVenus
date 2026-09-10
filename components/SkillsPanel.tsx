"use client";

// components/SkillsPanel.tsx
// Browse and install skills — each one folds reusable instructions into
// the agent's system prompt for every future task. Installing beyond
// your plan's limit prompts an upgrade instead.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { SKILL_CATEGORIES, SKILLS_CATALOG } from "@/lib/skills";
import { installSkill, uninstallSkill, listInstalledSkillIds } from "@/lib/skillConnections";
import { getUserPlanId } from "@/lib/userPlan";
import { getPlan } from "@/lib/plans";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  onInstalledChange?: (ids: string[]) => void;
  onUpgrade: () => void;
};

export default function SkillsPanel({ uid, open, onClose, onInstalledChange, onUpgrade }: Props) {
  const [installed, setInstalled] = useState<string[]>([]);
  const [maxSkills, setMaxSkills] = useState(1);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [ids, planId] = await Promise.all([listInstalledSkillIds(uid), getUserPlanId(uid)]);
      setInstalled(ids);
      setMaxSkills(getPlan(planId).maxSkills);
      setLoading(false);
    })();
  }, [open, uid]);

  async function toggle(skillId: string) {
    const isInstalled = installed.includes(skillId);
    if (!isInstalled && installed.length >= maxSkills) {
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

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Skills"
      subtitle={`${installed.length} of ${maxSkills} installed on your plan.`}
    >
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

      {installed.length >= maxSkills && (
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