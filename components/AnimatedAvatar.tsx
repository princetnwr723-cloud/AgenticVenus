"use client";

import { useMemo } from "react";

const SHAPES = ["circle", "ring", "triangle", "square", "hex", "blob"] as const;
const HUES = [10, 30, 50, 90, 140, 170, 200, 230, 260, 290, 320, 350];

function hashSeed(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return h;
}

export function avatarStyle(seed: string) {
  const h = hashSeed(seed);
  const hue = HUES[h % HUES.length];
  const shape = SHAPES[Math.floor(h / HUES.length) % SHAPES.length];
  return { hue, shape };
}

export default function AnimatedAvatar({ seed, size = 28 }: { seed: string; size?: number }) {
  const { hue, shape } = useMemo(() => avatarStyle(seed), [seed]);
  const color = `hsl(${hue}, 70%, 55%)`;
  const colorDark = `hsl(${hue}, 70%, 38%)`;

  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md"
      style={{ width: size, height: size, background: colorDark }}
    >
      {shape === "circle" && (
        <span className="avatar-pulse absolute rounded-full" style={{ width: "60%", height: "60%", background: color }} />
      )}
      {shape === "ring" && (
        <span
          className="avatar-spin absolute rounded-full border-2"
          style={{ width: "70%", height: "70%", borderColor: color, borderTopColor: "transparent" }}
        />
      )}
      {shape === "triangle" && (
        <span
          className="avatar-spin absolute"
          style={{
            width: 0,
            height: 0,
            borderLeft: `${size * 0.22}px solid transparent`,
            borderRight: `${size * 0.22}px solid transparent`,
            borderBottom: `${size * 0.38}px solid ${color}`,
          }}
        />
      )}
      {shape === "square" && (
        <span className="avatar-morph absolute" style={{ width: "55%", height: "55%", background: color }} />
      )}
      {shape === "hex" && (
        <span
          className="avatar-spin absolute"
          style={{
            width: "60%",
            height: "60%",
            background: color,
            clipPath: "polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%)",
          }}
        />
      )}
      {shape === "blob" && (
        <span className="avatar-wave absolute rounded-full" style={{ width: "65%", height: "65%", background: color }} />
      )}
    </span>
  );
}