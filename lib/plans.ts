// lib/plans.ts
// The three pricing tiers and what each unlocks. Single source of truth
// for limits — both the Pricing display and enforcement checks (install
// buttons, message sending) read from here.
//
// NOTE: this defines and enforces limits in-app. It does not process
// real payments yet — "Upgrade" doesn't charge a card. Wiring an actual
// checkout (Stripe is the natural choice) is the next step once ready to
// actually charge people; that needs a real Stripe account and its own
// setup, not just code.

export type PlanId = "free" | "pro" | "elite";

export type Plan = {
  id: PlanId;
  name: string;
  priceUsd: number;
  maxSkills: number;
  maxPluginsAndMcp: number; // combined cap across Plugins + MCP Tools
  aiMessagesPerDay: number | null; // null = unlimited
  tagline: string;
  color: string;
};

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: "free",
    name: "Free",
    priceUsd: 0,
    maxSkills: 1,
    maxPluginsAndMcp: 3,
    aiMessagesPerDay: 30,
    tagline: "Try the workspace with your own key.",
    color: "#8A8578",
  },
  pro: {
    id: "pro",
    name: "Pro",
    priceUsd: 29,
    maxSkills: 29,
    maxPluginsAndMcp: 29,
    aiMessagesPerDay: 300,
    tagline: "For running your workflows daily.",
    color: "#D97757",
  },
  elite: {
    id: "elite",
    name: "Elite",
    priceUsd: 100,
    maxSkills: 100,
    maxPluginsAndMcp: 100,
    aiMessagesPerDay: null,
    tagline: "Full team, full autonomy, no ceilings.",
    color: "#000000",
  },
};

export function getPlan(id: PlanId): Plan {
  return PLANS[id] ?? PLANS.free;
}