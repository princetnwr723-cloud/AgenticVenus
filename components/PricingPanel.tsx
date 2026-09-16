"use client";

// components/PricingPanel.tsx
// Free stays instant. Pro/Elite redirect to the real Gumroad checkout
// (with the user's uid attached as a url_param) — the actual upgrade
// happens via the Gumroad Ping webhook (app/api/gumroad/webhook), which
// verifies the sale server-side and flips the plan in Firestore. This
// panel just re-checks the plan on window focus so it picks up the
// upgrade as soon as the user comes back from the Gumroad tab.

import { useEffect, useState } from "react";
import SlideOverPanel from "@/components/SlideOverPanel";
import { PLANS, type PlanId, type Plan } from "@/lib/plans";
import { getUserPlanId, setUserPlanId } from "@/lib/userPlan";
import { buildGumroadCheckoutUrl } from "@/lib/gumroad";

type Props = {
  uid: string;
  open: boolean;
  onClose: () => void;
  currentPlanId: PlanId;
  onPlanChange: (planId: PlanId) => void;
};

export default function PricingPanel({ uid, open, onClose, currentPlanId, onPlanChange }: Props) {
  const [busyId, setBusyId] = useState<PlanId | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    function refetch() {
      getUserPlanId(uid).then(onPlanChange);
    }
    window.addEventListener("focus", refetch);
    return () => window.removeEventListener("focus", refetch);
  }, [uid, onPlanChange]);

  async function handleSelect(planId: PlanId) {
    if (planId === currentPlanId) return;
    setError(null);

    if (planId === "free") {
      setBusyId(planId);
      await setUserPlanId(uid, planId);
      onPlanChange(planId);
      setBusyId(null);
      return;
    }

    const productUrl =
      planId === "elite" ? process.env.NEXT_PUBLIC_GUMROAD_ELITE_URL : process.env.NEXT_PUBLIC_GUMROAD_PRO_URL;
    if (!productUrl) {
      setError(`Gumroad checkout for ${planId} isn't configured — set NEXT_PUBLIC_GUMROAD_${planId.toUpperCase()}_URL.`);
      return;
    }
    window.location.href = buildGumroadCheckoutUrl(productUrl, uid);
  }

  const plans: Plan[] = Object.values(PLANS);

  return (
    <SlideOverPanel
      open={open}
      onClose={onClose}
      title="Plans"
      subtitle="Skills, plugins/MCP slots, and daily AI usage scale with your plan."
    >
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
                {isCurrent
                  ? "Current plan"
                  : busyId === plan.id
                  ? "Switching..."
                  : plan.id === "free"
                  ? "Switch to Free"
                  : `Buy ${plan.name} on Gumroad`}
              </button>
            </div>
          );
        })}
      </div>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <p className="mt-4 text-xs text-ink/35">
        Pro and Elite open a real Gumroad checkout. Once payment goes
        through, Gumroad notifies us and your plan updates automatically
        — usually within a few seconds of coming back to this tab.
      </p>
    </SlideOverPanel>
  );
}