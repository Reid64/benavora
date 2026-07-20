import { Check } from "lucide-react";

import { Button } from "@/components/ui";
import { TIER_PLANS, type SubscriptionTier } from "@/lib/utils/constants";

export type PlanCardProps = {
  tier: SubscriptionTier;
  /** The org's current tier - highlights this card and disables its CTA. */
  currentTier: SubscriptionTier;
  /** Triggered when the user selects this plan (upgrade/downgrade). */
  onSelect: (tier: SubscriptionTier) => void;
  /** Disable the CTA while a checkout/portal request is in flight. */
  busy?: boolean;
};

const ORDER: Record<SubscriptionTier, number> = {
  free: 0,
  starter: 1,
  professional: 2,
  enterprise: 3,
  consultant: 4,
};

/** Plan accent colors (task spec: Starter/Professional/Enterprise; free and
 * consultant extended to match so every real tier in SUBSCRIPTION_TIERS has one). */
export const PLAN_COLORS: Record<SubscriptionTier, string> = {
  free: "#64748B",
  starter: "#0EA5E9",
  professional: "#8B5CF6",
  enterprise: "#10B981",
  consultant: "#F59E0B",
};

const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const BORDER = "#DCE6ED";

/**
 * A single subscription tier card (BLUEPRINT Phase 5 pricing). The current plan
 * is highlighted with a border in its plan color; other tiers show an Upgrade
 * or Downgrade CTA. The free tier has no Stripe price, so selecting it routes
 * through the billing portal (handled by the caller's onSelect).
 */
export function PlanCard({ tier, currentTier, onSelect, busy }: PlanCardProps) {
  const plan = TIER_PLANS[tier];
  const color = PLAN_COLORS[tier];
  const isCurrent = tier === currentTier;
  const isUpgrade = ORDER[tier] > ORDER[currentTier];

  const ctaLabel = isCurrent ? "Current plan" : isUpgrade ? "Upgrade" : "Downgrade";

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        borderRadius: "14px",
        border: isCurrent ? `2px solid ${color}` : `1px solid ${BORDER}`,
        boxShadow: isCurrent
          ? `0 4px 20px ${color}33`
          : "0 4px 20px rgba(0,0,0,0.06)",
        padding: "20px",
      }}
      className="flex flex-col"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 style={{ color: TEXT_PRIMARY }} className="text-lg font-semibold">
          {plan.name}
        </h3>
        {isCurrent && (
          <span
            style={{ backgroundColor: `${color}1A`, color }}
            className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold"
          >
            <span
              style={{ backgroundColor: color }}
              className="h-1.5 w-1.5 rounded-full"
              aria-hidden
            />
            Current
          </span>
        )}
      </div>
      <p style={{ color: TEXT_SECONDARY }} className="mt-0.5 text-sm">
        {plan.tagline}
      </p>

      <div className="mt-4 flex items-baseline gap-1">
        <span style={{ color: TEXT_PRIMARY }} className="text-3xl font-bold">
          ${plan.monthlyPrice}
        </span>
        <span style={{ color: TEXT_SECONDARY }} className="text-sm">
          /mo
        </span>
      </div>

      <ul className="mt-4 flex-1 space-y-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm" style={{ color: "#334155" }}>
            <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color }} aria-hidden />
            <span>{feature}</span>
          </li>
        ))}
      </ul>

      <div className="mt-5">
        <Button
          fullWidth
          variant={isUpgrade && !isCurrent ? "primary" : "secondary"}
          disabled={isCurrent || busy}
          onClick={() => onSelect(tier)}
          style={
            isUpgrade && !isCurrent
              ? { backgroundColor: color }
              : undefined
          }
        >
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
}
