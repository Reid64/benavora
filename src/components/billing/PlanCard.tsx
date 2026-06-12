import { Check } from "lucide-react";

import { Badge, Button } from "@/components/ui";
import { cn } from "@/lib/utils/cn";
import { TIER_PLANS, type SubscriptionTier } from "@/lib/utils/constants";

export type PlanCardProps = {
  tier: SubscriptionTier;
  /** The org's current tier — highlights this card and disables its CTA. */
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
};

/**
 * A single subscription tier card (BLUEPRINT Phase 5 pricing). The current plan
 * is highlighted; other tiers show an Upgrade or Downgrade CTA. The free tier
 * has no Stripe price, so selecting it routes through the billing portal.
 */
export function PlanCard({ tier, currentTier, onSelect, busy }: PlanCardProps) {
  const plan = TIER_PLANS[tier];
  const isCurrent = tier === currentTier;
  const isUpgrade = ORDER[tier] > ORDER[currentTier];

  const ctaLabel = isCurrent
    ? "Current plan"
    : isUpgrade
      ? "Upgrade"
      : "Downgrade";

  return (
    <div
      className={cn(
        "flex flex-col rounded-xl border bg-white p-5 shadow-sm",
        isCurrent ? "border-teal-400 ring-1 ring-teal-400" : "border-navy-200",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-lg font-semibold text-navy-900">{plan.name}</h3>
        {isCurrent && (
          <Badge color="green" withDot>
            Current
          </Badge>
        )}
      </div>
      <p className="mt-0.5 text-sm text-navy-500">{plan.tagline}</p>

      <div className="mt-4 flex items-baseline gap-1">
        <span className="text-3xl font-bold text-navy-900">
          ${plan.monthlyPrice}
        </span>
        <span className="text-sm text-navy-500">/mo</span>
      </div>

      <ul className="mt-4 flex-1 space-y-2">
        {plan.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-sm text-navy-700">
            <Check className="mt-0.5 h-4 w-4 shrink-0 text-teal-500" aria-hidden />
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
        >
          {ctaLabel}
        </Button>
      </div>
    </div>
  );
}
