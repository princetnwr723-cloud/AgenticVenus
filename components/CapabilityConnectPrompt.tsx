"use client";

type Props = { kind: "browser" | "computer"; onSettings: () => void };
export default function CapabilityConnectPrompt({ kind, onSettings }: Props) {
  const browser = kind === "browser";
  return (
    <div className="animate-fade-in-up rounded-2xl border border-ink/10 bg-white px-4 py-3 shadow-sm">
      <p className="text-sm font-medium text-ink">I need {browser ? "a real browser" : "a cloud computer"} to do this for you.</p>
      <p className="mt-1 text-xs leading-relaxed text-ink/55">
        {browser ? "Connect Browserless in Settings → Integrations. If you need a signed-in website account, add/use its browser profile there and the agent will reuse it; otherwise I’ll ask you to connect the service rather than guessing." : "Connect Daytona in Settings → Integrations so I can use a persistent terminal and computer workspace."}
      </p>
      <button onClick={onSettings} className="mt-3 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-cream hover:opacity-90">Open Settings</button>
    </div>
  );
}
