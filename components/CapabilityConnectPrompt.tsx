"use client";

type Props = { kind: "browser" | "computer" | "browserProfile"; onSettings: () => void };
export default function CapabilityConnectPrompt({ kind, onSettings }: Props) {
  const browser = kind === "browser";
  const profile = kind === "browserProfile";
  const title = profile ? "I need a signed-in browser profile to do this." : browser ? "I need a real browser to do this for you." : "I need a cloud computer to do this for you.";
  const text = profile
    ? "For Gmail/Outlook or another signed-in site, connect the service through Plugins/MCP, or create an authenticated Browserless profile. AgenticVenus will reuse that profile; it will not ask you to paste your password into chat."
    : browser
      ? "Connect Browserless in Settings → Integrations. The agent will start and control the browser automatically when a task needs it."
      : "Connect Daytona in Settings → Integrations so I can use a real cloud desktop, terminal and persistent workspace.";
  return (
    <div className="animate-fade-in-up rounded-2xl border border-ink/10 bg-white px-4 py-3 shadow-sm">
      <p className="text-sm font-medium text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink/55">{text}</p>
      <button onClick={onSettings} className="mt-3 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-cream hover:opacity-90">Open Settings</button>
    </div>
  );
}
