"use client";

import AnimatedAvatar from "@/components/AnimatedAvatar";

const SEEDS = Array.from({ length: 54 }, (_, i) => `a${i + 1}`);

export default function AvatarPicker({ value, onChange }: { value: string; onChange: (seed: string) => void }) {
  return (
    <div className="grid grid-cols-9 gap-2">
      {SEEDS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onChange(s)}
          className={`flex items-center justify-center rounded-md p-1 transition-all ${
            value === s ? "ring-2 ring-clay" : "hover:bg-sand"
          }`}
        >
          <AnimatedAvatar seed={s} size={28} />
        </button>
      ))}
    </div>
  );
}