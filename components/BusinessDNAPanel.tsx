"use client";

// components/BusinessDNAPanel.tsx
// Lets the user describe their business once. Saved details are woven
// into every agent's system prompt (see lib/businessDNA.ts) so replies
// sound like they're coming from someone who works there.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { getBusinessDNA, saveBusinessDNA, type BusinessDNA } from "@/lib/businessDNA";

const EMPTY: BusinessDNA = {
  businessName: "",
  industry: "",
  description: "",
  tone: "",
  offerings: "",
  policies: "",
};

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  onSaved: (dna: BusinessDNA) => void;
};

export default function BusinessDNAPanel({ uid, open, onClose, onSaved }: Props) {
  const [form, setForm] = useState<BusinessDNA>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      setLoading(true);
      const existing = await getBusinessDNA(uid);
      setForm(existing ?? EMPTY);
      setLoading(false);
    })();
  }, [open, uid]);

  function update<K extends keyof BusinessDNA>(key: K, value: string) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  async function handleSave() {
    if (!form.businessName.trim()) return;
    setSaving(true);
    await saveBusinessDNA(uid, form);
    onSaved(form);
    setSaving(false);
    setSaved(true);
  }

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Business DNA"
      subtitle="Teach your agent about your business so it can work like an employee."
    >
      {loading ? (
        <p className="text-sm text-ink/50">Loading...</p>
      ) : (
        <div className="space-y-4">
          <Field
            label="Business name"
            value={form.businessName}
            onChange={(v) => update("businessName", v)}
            placeholder="e.g. Venus Coffee Roasters"
          />
          <Field
            label="Industry"
            value={form.industry}
            onChange={(v) => update("industry", v)}
            placeholder="e.g. Coffee & retail"
          />
          <Field
            label="What does the business do?"
            value={form.description}
            onChange={(v) => update("description", v)}
            placeholder="Short description of the business"
            textarea
          />
          <Field
            label="Products / services offered"
            value={form.offerings}
            onChange={(v) => update("offerings", v)}
            placeholder="What you sell or provide"
            textarea
          />
          <Field
            label="Tone of voice"
            value={form.tone}
            onChange={(v) => update("tone", v)}
            placeholder="e.g. Friendly and casual, but professional"
          />
          <Field
            label="Policies to respect"
            value={form.policies}
            onChange={(v) => update("policies", v)}
            placeholder="Refund policy, hours, things it should never promise, etc."
            textarea
          />

          <button
            onClick={handleSave}
            disabled={!form.businessName.trim() || saving}
            className="focus-ring w-full rounded-md bg-clay px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark disabled:opacity-50 disabled:hover:scale-100"
          >
            {saving ? "Saving..." : saved ? "Saved ✓" : "Save business DNA"}
          </button>
          <p className="text-xs text-ink/40">
            This shapes what your agent knows and how it talks — it doesn't
            retrain the underlying model, it gives it context every time it
            replies.
          </p>
        </div>
      )}
    </SlideOverPanel>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  textarea,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  textarea?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm text-ink/70">{label}</label>
      {textarea ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={3}
          className="focus-ring w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />
      )}
    </div>
  );
}
