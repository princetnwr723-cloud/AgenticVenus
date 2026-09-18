"use client";

import { useState } from "react";
import AnimatedAvatar from "@/components/AnimatedAvatar";
import AvatarPicker from "@/components/AvatarPicker";
import type { AgentIdentity } from "@/lib/agentIdentity";

type Props = {
  open: boolean;
  identity: AgentIdentity;
  onClose: () => void;
  onSave: (identity: AgentIdentity) => void;
};

export default function AgentSettingsModal({ open, identity, onClose, onSave }: Props) {
  const [name, setName] = useState(identity.name);
  const [avatarSeed, setAvatarSeed] = useState(identity.avatarSeed);
  const [customPrompt, setCustomPrompt] = useState(identity.customPrompt || "");

  if (!open) return null;

  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4" onClick={onClose}>
      <div className="animate-scale-in max-h-[85vh] w-full max-w-md overflow-y-auto rounded-card bg-cream p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3">
          <AnimatedAvatar seed={avatarSeed} size={36} />
          <h2 className="font-serif text-xl text-ink">Agent settings</h2>
        </div>

        <label className="mb-1 mt-5 block text-sm text-ink/70">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="focus-ring w-full rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />

        <label className="mb-1 mt-4 block text-sm text-ink/70">Avatar</label>
        <AvatarPicker value={avatarSeed} onChange={setAvatarSeed} />

        <label className="mb-1 mt-4 block text-sm text-ink/70">Custom instructions (optional)</label>
        <textarea
          value={customPrompt}
          onChange={(e) => setCustomPrompt(e.target.value)}
          rows={4}
          placeholder="Extra system prompt just for this agent — layered on top of its usual specialty."
          className="focus-ring w-full resize-none rounded-md border border-ink/15 bg-white px-3 py-2.5 text-sm outline-none"
        />

        <div className="mt-5 flex gap-2">
          <button
            onClick={() => onSave({ name: name.trim() || identity.name, avatarSeed, customPrompt: customPrompt.trim() || undefined })}
            className="focus-ring flex-1 rounded-md bg-clay px-4 py-2.5 text-sm font-medium text-cream transition-all hover:scale-[1.02] hover:bg-clay-dark"
          >
            Save
          </button>
          <button onClick={onClose} className="rounded-md border border-ink/15 px-4 py-2.5 text-sm text-ink/60 hover:bg-sand">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}