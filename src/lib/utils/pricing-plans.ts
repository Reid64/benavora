// Shared pricing data for /pricing and the /register plan pre-selection banner.
// Keep in sync manually — see PricingPageClient.tsx and RegisterPageClient.tsx.
export type PlanId = "starter" | "professional" | "enterprise";

export const PRICING_PLANS: Record<
  PlanId,
  { name: string; monthly: number; annual: number }
> = {
  starter: { name: "Starter", monthly: 397, annual: 317 },
  professional: { name: "Professional", monthly: 897, annual: 717 },
  enterprise: { name: "Enterprise", monthly: 1997, annual: 1597 },
};

export function isPlanId(value: string | null): value is PlanId {
  return value === "starter" || value === "professional" || value === "enterprise";
}
