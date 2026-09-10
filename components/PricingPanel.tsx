"use client";

// components/PricingPanel.tsx
// Shows Free / Pro / Elite. Picking a plan updates limits in Firestore
// immediately — it does NOT charge any money yet. Real payment (Stripe)
// is the natural next step once business/checkout setup is ready.

import { useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { PLANS, type PlanId, type Plan } from "@/lib/plans";
import { setUserPlanId } from "@/lib/userPlan";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  currentPlanId: PlanId;
  onPlanChange: (planId: PlanId) => void;
};

export default function PricingPanel({ uid, open, onClose, currentPlanId, onPlanChange }: Props) {
  const [busyId, setBusyId] = useState<PlanId | null>(null);

  async function handleSelect(planId: PlanId) {
    if (planId === currentPlanId) return;
    setBusyId(planId);
    await setUserPlanId(uid, planId);
    onPlanChange(planId);
    setBusyId(null);
  }

  const plans: Plan[] = Object.values(PLANS);

  return (
    <SlideOverPanel open={open} onClose={onClose} title="Plans" subtitle="Skills, plugins/MCP slots, and daily AI usage scale with your plan.">
      <div className="space-y-3">
        {plans.map((plan) => {
          const isCurrent = plan.id === currentPlanId;
          return (
            <div
              key={plan.id}
              className={`rounded-card border px-4 py-4 transition-all ${
                isCurrent ? "border-clay/40 bg-clay/5" : "border-ink/10 bg-white"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <h3 className="font-serif text-lg text-ink">{plan.name}</h3>
                <p className="text-lg font-semibold text-ink">
                  ${plan.priceUsd}
                  <span className="text-xs font-normal text-ink/40">/mo</span>
                </p>
              </div>
              <p className="mt-1 text-xs text-ink/50">{plan.tagline}</p>
              <ul className="mt-3 space-y-1 text-xs text-ink/70">
                <li>• {plan.maxSkills} skills</li>
                <li>• {plan.maxPluginsAndMcp} plugins + MCP tools</li>
                <li>• {plan.aiMessagesPerDay === null ? "Unlimited" : `${plan.aiMessagesPerDay}`} AI messages/day</li>
              </ul>
              <button
                onClick={() => handleSelect(plan.id)}
                disabled={isCurrent || busyId === plan.id}
                className={`focus-ring mt-4 w-full rounded-md px-4 py-2 text-sm font-medium transition-all disabled:opacity-60 ${
                  isCurrent ? "bg-moss/10 text-moss" : "bg-ink text-cream hover:scale-[1.02] hover:bg-ink/90"
                }`}
              >
                {isCurrent ? "Current plan" : busyId === plan.id ? "Switching..." : `Switch to ${plan.name}`}
              </button>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-ink/35">
        Switching plans here doesn't charge a card yet — it just changes
        your limits immediately, for testing. Real checkout is a separate
        step to wire up when you're ready to actually charge people.
      </p>
    </SlideOverPanel>
  );
}