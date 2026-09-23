"use client";

// components/SkillsPanel.tsx
// Browse and install skills — catalog ones, imported from a SKILL.md link,
// or found via the new "Find skills" search (uses the real web-search
// plugin to locate public SKILL.md files, then runs them through the same
// fetch-and-parse import as pasting a link).

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { SKILL_CATEGORIES, SKILLS_CATALOG, type Skill } from "@/lib/skills";
import { installSkill, uninstallSkill, listInstalledSkillIds } from "@/lib/skillConnections";
import { listCustomSkills, saveCustomSkill, deleteCustomSkill } from "@/lib/customSkills";
import { importSkillFromUrl } from "@/lib/skillImportClient";
import { getUserPlanId } from "@/lib/userPlan";
import { getPlan } from "@/lib/plans";
import { SKILL_HUB_CATEGORIES, parseSkillSearchResults, type SkillHubResult } from "@/lib/skillHub";
import { listConnectedPluginIds } from "@/lib/pluginConnections";
import { callPluginAction } from "@/lib/pluginOrchestrator";

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

  const [webSearchOn, setWebSearchOn] = useState(false);
  const [hubQuery, setHubQuery] = useState("");
  const [hubSearching, setHubSearching] = useState(false);
  const [hubResults, setHubResults] = useState<SkillHubResult[] | null>(null);
  const [hubError, setHubError] = useState<string | null>(null);
  const [importingUrl, setImportingUrl] = useState<string | null>(null);

  const totalInstalled = installed.length + customSkills.length;

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const [ids, custom, planId, toolIds] = await Promise.all([
        listInstalledSkillIds(uid),
        listCustomSkills(uid),
        getUserPlanId(uid),
        listConnectedPluginIds(uid),
      ]);
      setInstalled(ids);
      setCustomSkills(custom);
      setMaxSkills(getPlan(planId).maxSkills);
      setWebSearchOn(toolIds.includes("web-search"));
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

  async function installFromUrl(url: string): Promise<Skill> {
    const parsed = await importSkillFromUrl(url);
    const skill: Skill = {
      id: parsed.id,
      name: parsed.name,
      category: "writing",
      description: parsed.description,
      color: "#8A8578",
      instructions: parsed.instructions,
    };
    await saveCustomSkill(uid, skill, url);
    const next = [...customSkills.filter((s) => s.id !== skill.id), skill];
    setCustomSkills(next);
    onCustomSkillsChange?.(next);
    return skill;
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
      const skill = await installFromUrl(importUrl.trim());
      setImportUrl("");
      setExpandedId(skill.id);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : "Failed to import that skill.");
    } finally {
      setImporting(false);
    }
  }

  async function handleHubSearch(query: string) {
    if (!query.trim()) return;
    setHubQuery(query);
    setHubSearching(true);
    setHubError(null);
    setHubResults(null);
    try {
      const raw = await callPluginAction("web-search", "web-search.search", { query: `"SKILL.md" ${query}` });
      setHubResults(parseSkillSearchResults(raw));
    } catch (err) {
      setHubError(err instanceof Error ? err.message : "Search failed.");
    } finally {
      setHubSearching(false);
    }
  }

  async function handleHubInstall(result: SkillHubResult) {
    if (totalInstalled >= maxSkills) {
      onUpgrade();
      return;
    }
    setImportingUrl(result.url);
    setHubError(null);
    try {
      const skill = await installFromUrl(result.url);
      setExpandedId(skill.id);
      setHubResults((prev) => prev?.filter((r) => r.url !== result.url) || null);
    } catch (err) {
      setHubError(err instanceof Error ? `${result.title}: ${err.message}` : "Couldn't install that one.");
    } finally {
      setImportingUrl(null);
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
      {/* ---------------- Find skills (Hub) ---------------- */}
      <div className="mb-8 rounded-md border border-clay/20 bg-clay/5 p-3">
        <h3 className="text-sm font-medium text-ink">Find skills</h3>
        <p className="mt-0.5 text-xs text-ink/55">
          Searches the web for real, public SKILL.md files and installs the one you pick — same as pasting a link, just found for you.
        </p>
        {!webSearchOn && (
          <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800">
            Turn on the <strong>Web Search</strong> plugin (Plugins → Search &amp; Data) to use this.
          </p>
        )}
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SKILL_HUB_CATEGORIES.map((c) => (
            <button
              key={c}
              onClick={() => handleHubSearch(c)}
              disabled={!webSearchOn || hubSearching}
              className="rounded-full border border-ink/10 bg-white px-2.5 py-1 text-xs text-ink/70 transition-colors hover:bg-sand disabled:opacity-50"
            >
              {c}
            </button>
          ))}
        </div>
        <div className="mt-2 flex items-center gap-2">
          <input
            value={hubQuery}
            onChange={(e) => setHubQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleHubSearch(hubQuery)}
            placeholder="Or search anything, e.g. “email newsletter writing”"
            disabled={!webSearchOn}
            className="focus-ring flex-1 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm outline-none disabled:opacity-50"
          />
          <button
            onClick={() => handleHubSearch(hubQuery)}
            disabled={!webSearchOn || !hubQuery.trim() || hubSearching}
            className="shrink-0 rounded-md bg-clay px-3 py-2 text-xs font-medium text-cream transition-colors hover:bg-clay-dark disabled:opacity-50"
          >
            {hubSearching ? "Searching…" : "Search"}
          </button>
        </div>
        {hubError && <p className="mt-1.5 text-xs text-red-600">{hubError}</p>}
        {hubResults && (
          <div className="mt-2 space-y-1.5">
            {hubResults.length === 0 ? (
              <p className="text-xs text-ink/45">No public SKILL.md files turned up for that — try a different phrase.</p>
            ) : (
              hubResults.map((r) => (
                <div key={r.url} className="flex items-center gap-2 rounded-md border border-ink/10 bg-white px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium text-ink">{r.title}</p>
                    <p className="truncate text-[11px] text-ink/45">{r.url}</p>
                  </div>
                  <button
                    onClick={() => handleHubInstall(r)}
                    disabled={importingUrl === r.url}
                    className="shrink-0 rounded-md border border-clay/30 bg-clay/10 px-2.5 py-1 text-xs font-medium text-clay hover:bg-clay/20 disabled:opacity-50"
                  >
                    {importingUrl === r.url ? "Installing…" : "Install"}
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>

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