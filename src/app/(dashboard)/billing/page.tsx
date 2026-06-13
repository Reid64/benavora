"use client";

import { useCallback, useEffect, useState } from "react";
import { CreditCard, ExternalLink, ReceiptText, ShieldAlert } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
} from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { PlanCard } from "@/components/billing/PlanCard";
import { UsageMeter } from "@/components/billing/UsageMeter";
import { useProfile } from "@/lib/hooks/useProfile";
import {
  SUBSCRIPTION_TIERS,
  TIER_PLANS,
  type SubscriptionTier,
} from "@/lib/utils/constants";
import { formatCurrency, formatDate, humanizeEnum } from "@/lib/utils/formatters";

type UsageMetric = { used: number; limit: number };

type BillingData = {
  subscription: {
    tier: SubscriptionTier;
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    stripe_subscription_id: string | null;
  };
  usage: {
    agent_runs: UsageMetric;
    storage_mb: UsageMetric;
    users: UsageMetric;
    search_profiles: UsageMetric;
  };
  invoices: {
    id: string;
    amount_cents: number;
    currency: string;
    status: string;
    description: string | null;
    invoice_url: string | null;
    paid_at: string | null;
    created_at: string;
  }[];
  billingEnabled: boolean;
};

const STATUS_BADGE: Record<string, BadgeColor> = {
  active: "green",
  trialing: "blue",
  past_due: "red",
  cancelled: "gray",
};

/**
 * Billing & subscription management (BLUEPRINT Phase 5 / PRD). Owner-only:
 * the route is already owner-gated in the sidebar, and this page re-checks the
 * session role as a second barrier. Shows the current plan, live usage vs. tier
 * limits, the full plan grid, a portal link, and invoice history.
 */
export default function BillingPage() {
  const { profile, loading: profileLoading } = useProfile();
  const isOwner = profile?.role === "owner";

  const [data, setData] = useState<BillingData | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/billing");
      const json = (await res.json().catch(() => null)) as
        | (BillingData & { error?: string })
        | null;
      if (!res.ok || !json) {
        setLoadError(json?.error ?? "Could not load billing.");
        setLoading(false);
        return;
      }
      setData(json);
    } catch {
      setLoadError("Could not reach the server. Please try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!profileLoading && isOwner) void load();
    else if (!profileLoading) setLoading(false);
  }, [profileLoading, isOwner, load]);

  async function startCheckout(tier: SubscriptionTier) {
    setActionError(null);

    // Free tier (or any change to/from an active subscription) is managed in the
    // Stripe portal; paid tiers without an active subscription go to Checkout.
    const hasActiveSub = Boolean(data?.subscription.stripe_subscription_id);
    setBusy(true);
    try {
      let res: Response;
      if (tier === "free" || hasActiveSub) {
        res = await fetch("/api/billing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "portal" }),
        });
      } else {
        res = await fetch("/api/billing", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "checkout", tier }),
        });
      }
      const json = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (!res.ok || !json?.url) {
        setActionError(json?.error ?? "Could not start the billing session.");
        return;
      }
      window.location.href = json.url;
    } catch {
      setActionError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function openPortal() {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "portal" }),
      });
      const json = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (!res.ok || !json?.url) {
        setActionError(json?.error ?? "Could not open the billing portal.");
        return;
      }
      window.location.href = json.url;
    } catch {
      setActionError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Billing
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Manage your subscription, usage, and invoices.
        </p>
      </div>

      {profileLoading ? (
        <LoadingSpinner center label="Loading billing..." />
      ) : !isOwner ? (
        <Card>
          <EmptyState
            icon={ShieldAlert}
            title="Owner access required"
            description="Only the organization owner can manage billing."
          />
        </Card>
      ) : loading ? (
        <LoadingSpinner center label="Loading billing..." />
      ) : loadError || !data ? (
        <Card>
          <EmptyState
            icon={CreditCard}
            title="Billing unavailable"
            description={loadError ?? "Your billing details could not be loaded."}
          />
        </Card>
      ) : (
        <>
          {actionError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            >
              {actionError}
            </div>
          )}

          {!data.billingEnabled && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Stripe is not configured on this server. Plan changes are disabled;
              usage and limits below reflect your current tier.
            </div>
          )}

          {/* Current plan + usage */}
          <Card
            title="Current plan"
            description="Your subscription and usage against this tier's limits."
            actions={
              data.subscription.stripe_subscription_id ? (
                <Button
                  variant="secondary"
                  onClick={openPortal}
                  isLoading={busy}
                  disabled={!data.billingEnabled}
                >
                  <CreditCard className="h-4 w-4" aria-hidden />
                  Manage billing
                </Button>
              ) : undefined
            }
          >
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xl font-semibold text-navy-900">
                  {TIER_PLANS[data.subscription.tier].name}
                </span>
                <Badge color={STATUS_BADGE[data.subscription.status] ?? "gray"}>
                  {humanizeEnum(data.subscription.status)}
                </Badge>
                {data.subscription.cancel_at_period_end && (
                  <Badge color="yellow">Cancels at period end</Badge>
                )}
                {data.subscription.current_period_end && (
                  <span className="text-sm text-navy-500">
                    Renews {formatDate(data.subscription.current_period_end)}
                  </span>
                )}
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <UsageMeter
                  label="Agent runs / day"
                  used={data.usage.agent_runs.used}
                  limit={data.usage.agent_runs.limit}
                />
                <UsageMeter
                  label="Storage"
                  used={data.usage.storage_mb.used}
                  limit={data.usage.storage_mb.limit}
                  unit="MB"
                />
                <UsageMeter
                  label="Users"
                  used={data.usage.users.used}
                  limit={data.usage.users.limit}
                />
                <UsageMeter
                  label="Search profiles"
                  used={data.usage.search_profiles.used}
                  limit={data.usage.search_profiles.limit}
                />
              </div>
            </div>
          </Card>

          {/* Plan grid */}
          <Card
            title="Plans"
            description="Upgrade or downgrade your subscription at any time."
          >
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-4">
              {SUBSCRIPTION_TIERS.map((tier) => (
                <PlanCard
                  key={tier}
                  tier={tier}
                  currentTier={data.subscription.tier}
                  onSelect={startCheckout}
                  busy={busy || !data.billingEnabled}
                />
              ))}
            </div>
          </Card>

          {/* Invoices */}
          <Card title="Invoice history" description="Your past invoices.">
            {data.invoices.length === 0 ? (
              <EmptyState
                icon={ReceiptText}
                title="No invoices yet"
                description="Invoices will appear here once you subscribe to a paid plan."
              />
            ) : (
              <ul className="divide-y divide-navy-100">
                {data.invoices.map((invoice) => (
                  <li
                    key={invoice.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-navy-900">
                        {formatCurrency(invoice.amount_cents / 100)}{" "}
                        <span className="text-sm font-normal text-navy-500">
                          {invoice.currency.toUpperCase()}
                        </span>
                      </p>
                      <p className="mt-0.5 text-sm text-navy-500">
                        {invoice.description ?? "Subscription"} ·{" "}
                        {formatDate(invoice.paid_at ?? invoice.created_at)}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge
                        color={invoice.status === "paid" ? "green" : "yellow"}
                      >
                        {humanizeEnum(invoice.status)}
                      </Badge>
                      {invoice.invoice_url && (
                        <a
                          href={invoice.invoice_url}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-sm font-medium text-teal-600 hover:text-teal-700"
                        >
                          View
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}
