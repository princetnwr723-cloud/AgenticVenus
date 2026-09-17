"use client";

type Props = { icon: string; text: string };

export default function AgentStatusLine({ icon, text }: Props) {
  return (
    <div className="animate-fade-in flex items-center gap-2 text-xs text-ink/50">
      <span className="animate-pulse">{icon}</span>
      <span>{text}</span>
    </div>
  );
}