"use client";

import { useCallback, useEffect, useState } from "react";
import { Check, CreditCard, ExternalLink, ReceiptText, ShieldAlert } from "lucide-react";

import { EmptyState, LoadingSpinner, Button, Table } from "@/components/ui";
import type { TableColumn } from "@/components/ui";
import { PlanCard, PLAN_COLORS } from "@/components/billing/PlanCard";
import { useProfile } from "@/lib/hooks/useProfile";
import {
  SUBSCRIPTION_TIERS,
  TIER_PLANS,
  type SubscriptionTier,
} from "@/lib/utils/constants";
import { formatCurrency, formatDate } from "@/lib/utils/formatters";

// Design system (BLUEPRINT §7 / STANDING_DIRECTIVES Directive 4): inline
// style={{}} with hardcoded hex only - never CSS variables or Tailwind color
// tokens for this page's colors.
const CANVAS = "#D6E4F0";
const CARD = "#FFFFFF";
const ACCENT = "#3D6B50";
const BORDER = "#DCE6ED";
const TEXT_PRIMARY = "#0F172A";
const TEXT_SECONDARY = "#64748B";
const TEXT_MUTED = "#94A3B8";

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
  autoapplySubmissionsThisMonth: number;
  billingEnabled: boolean;
};

type UsageResourceSummary = {
  resource: string;
  current: number;
  limit: number;
  allowed: boolean;
  period: string;
};

type UsageSummary = {
  tier: string;
  resources: Record<string, UsageResourceSummary>;
};

const STATUS_META: Record<string, { label: string; color: string; pulse: boolean }> = {
  active: { label: "Active", color: "#10B981", pulse: true },
  trialing: { label: "Trialing", color: ACCENT, pulse: true },
  past_due: { label: "Past Due", color: "#EF4444", pulse: true },
  cancelled: { label: "Canceled", color: "#94A3B8", pulse: false },
};

function statusMeta(status: string) {
  return STATUS_META[status] ?? { label: status, color: TEXT_MUTED, pulse: false };
}

const INVOICE_STATUS_META: Record<string, { label: string; color: string }> = {
  paid: { label: "Paid", color: "#10B981" },
  open: { label: "Open", color: "#F59E0B" },
  void: { label: "Void", color: "#94A3B8" },
  uncollectible: { label: "Failed", color: "#EF4444" },
};

/** Colored pulse-dot status badge (Active/Past Due pulse; Canceled is static). */
function StatusPulseBadge({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <span
      style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
      className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold"
    >
      <span className="relative flex h-2 w-2">
        {meta.pulse && (
          <span
            style={{ backgroundColor: meta.color }}
            className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
            aria-hidden
          />
        )}
        <span
          style={{ backgroundColor: meta.color }}
          className="relative inline-flex h-2 w-2 rounded-full"
          aria-hidden
        />
      </span>
      {meta.label}
    </span>
  );
}

function UsageStatBar({
  label,
  current,
  limit,
  unit,
  period,
}: {
  label: string;
  current: number;
  limit: number;
  unit?: string;
  period?: string;
}) {
  const unlimited = limit === -1;
  const pct = unlimited
    ? 0
    : limit > 0
      ? Math.min(100, Math.round((current / limit) * 100))
      : current > 0
        ? 100
        : 0;
  const barColor = pct >= 90 ? "#EF4444" : pct >= 75 ? "#F59E0B" : "#14B8A6";
  const u = unit ? ` ${unit}` : "";

  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between gap-2">
        <span style={{ color: TEXT_PRIMARY }} className="text-sm font-semibold">
          {label}
          {period && (
            <span style={{ color: TEXT_MUTED }} className="ml-1.5 text-xs font-normal">
              ({period})
            </span>
          )}
        </span>
        <span
          style={{ color: !unlimited && pct >= 90 ? "#DC2626" : TEXT_MUTED }}
          className="text-xs font-medium"
        >
          {unlimited
            ? `${current.toLocaleString()}${u} / Unlimited`
            : `${current.toLocaleString()}${u} / ${limit.toLocaleString()}${u}`}
        </span>
      </div>
      <div style={{ backgroundColor: "#F1F5F9" }} className="h-2 w-full overflow-hidden rounded-full">
        {unlimited ? (
          <div style={{ backgroundColor: "#E2E8F0" }} className="h-full w-full rounded-full" />
        ) : (
          <div
            style={{ width: `${pct}%`, backgroundColor: barColor }}
            className="h-full rounded-full transition-all"
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={`${label} usage: ${pct}%`}
          />
        )}
      </div>
    </div>
  );
}

function UsageStatCount({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div>
      <p style={{ color: TEXT_PRIMARY }} className="text-sm font-semibold">
        {label}
      </p>
      <p style={{ color: TEXT_PRIMARY }} className="mt-1.5 text-2xl font-bold">
        {value.toLocaleString()}
      </p>
      {hint && (
        <p style={{ color: TEXT_MUTED }} className="mt-0.5 text-xs">
          {hint}
        </p>
      )}
    </div>
  );
}

function SectionCard({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        backgroundColor: CARD,
        borderRadius: "14px",
        boxShadow: "0 4px 20px rgba(0,0,0,0.08)",
      }}
      className="overflow-hidden"
    >
      <div
        style={{ borderBottom: `1px solid ${BORDER}` }}
        className="flex flex-wrap items-start justify-between gap-3 px-6 py-4"
      >
        <div>
          <h2 style={{ color: TEXT_PRIMARY }} className="text-base font-semibold">
            {title}
          </h2>
          {description && (
            <p style={{ color: TEXT_MUTED }} className="mt-0.5 text-xs">
              {description}
            </p>
          )}
        </div>
        {actions}
      </div>
      <div className="p-6">{children}</div>
    </div>
  );
}

/**
 * Subscription & billing management (BLUEPRINT Phase 5 / Behavioral Contracts
 * §22, §25). Owner-only. Shows the current plan with live renewal/status,
 * real usage against tier limits, the full plan grid, and invoice history.
 * Plan changes route through Stripe Checkout (new subscription) or the Stripe
 * Billing Portal (POST /api/stripe/create-portal-session - manage/downgrade/
 * cancel an existing subscription).
 */
export default function BillingPage() {
  const { profile, loading: profileLoading } = useProfile();
  const isOwner = profile?.role === "owner";

  const [data, setData] = useState<BillingData | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [billingRes, usageRes] = await Promise.all([
        fetch("/api/billing"),
        fetch("/api/billing/usage"),
      ]);
      const billingJson = (await billingRes.json().catch(() => null)) as
        | (BillingData & { error?: string })
        | null;
      if (!billingRes.ok || !billingJson) {
        setLoadError(billingJson?.error ?? "Could not load billing.");
        setLoading(false);
        return;
      }
      setData(billingJson);
      if (usageRes.ok) {
        setUsage((await usageRes.json().catch(() => null)) as UsageSummary | null);
      }
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

  async function openPortal() {
    setActionError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/stripe/create-portal-session", { method: "POST" });
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

  async function startCheckout(tier: SubscriptionTier) {
    setActionError(null);
    // Free tier (or any change to/from an active subscription) is managed in
    // the Stripe portal; paid tiers without an active subscription go to
    // Checkout (BLUEPRINT Phase 5 - Checkout is for net-new subscriptions only).
    const hasActiveSub = Boolean(data?.subscription.stripe_subscription_id);
    if (tier === "free" || hasActiveSub) {
      await openPortal();
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "checkout", tier }),
      });
      const json = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (!res.ok || !json?.url) {
        setActionError(json?.error ?? "Could not start checkout.");
        return;
      }
      window.location.href = json.url;
    } catch {
      setActionError("Could not reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const plan = data ? TIER_PLANS[data.subscription.tier] : null;
  const planColor = data ? PLAN_COLORS[data.subscription.tier] : ACCENT;
  const hasActiveSub = Boolean(data?.subscription.stripe_subscription_id);

  const invoiceColumns: TableColumn<BillingData["invoices"][number]>[] = [
    {
      key: "date",
      header: "Date",
      sortable: true,
      sortValue: (row) => new Date(row.paid_at ?? row.created_at).getTime(),
      render: (row) => (
        <span style={{ color: TEXT_PRIMARY }}>{formatDate(row.paid_at ?? row.created_at)}</span>
      ),
    },
    {
      key: "amount",
      header: "Amount",
      sortable: true,
      sortValue: (row) => row.amount_cents,
      render: (row) => (
        <span style={{ color: TEXT_PRIMARY }} className="font-medium">
          {formatCurrency(row.amount_cents / 100)}{" "}
          <span style={{ color: TEXT_MUTED }} className="text-xs font-normal">
            {row.currency.toUpperCase()}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      render: (row) => {
        const meta = INVOICE_STATUS_META[row.status] ?? {
          label: row.status,
          color: TEXT_MUTED,
        };
        return (
          <span
            style={{ backgroundColor: `${meta.color}1A`, color: meta.color }}
            className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold"
          >
            {meta.label}
          </span>
        );
      },
    },
    {
      key: "pdf",
      header: "Invoice",
      render: (row) =>
        row.invoice_url ? (
          <a
            href={row.invoice_url}
            target="_blank"
            rel="noreferrer"
            style={{ color: ACCENT }}
            className="inline-flex items-center gap-1 text-sm font-medium hover:underline"
          >
            Download PDF
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </a>
        ) : (
          <span style={{ color: TEXT_MUTED }}>—</span>
        ),
    },
  ];

  return (
    <div style={{ backgroundColor: CANVAS, minHeight: "100vh" }} className="space-y-6 p-6">
      <div>
        <h1 style={{ color: TEXT_PRIMARY }} className="text-2xl font-bold tracking-tight">
          Billing
        </h1>
        <p style={{ color: TEXT_SECONDARY }} className="mt-1 text-sm">
          Manage your subscription, usage, and invoices.
        </p>
      </div>

      {profileLoading ? (
        <div style={{ backgroundColor: CARD, borderRadius: "14px" }} className="p-10">
          <LoadingSpinner center label="Loading billing..." />
        </div>
      ) : !isOwner ? (
        <div style={{ backgroundColor: CARD, borderRadius: "14px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }} className="p-6">
          <EmptyState
            icon={ShieldAlert}
            title="Owner access required"
            description="Only the organization owner can manage billing."
          />
        </div>
      ) : loading ? (
        <div style={{ backgroundColor: CARD, borderRadius: "14px" }} className="p-10">
          <LoadingSpinner center label="Loading billing..." />
        </div>
      ) : loadError || !data || !plan ? (
        <div style={{ backgroundColor: CARD, borderRadius: "14px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }} className="p-6">
          <EmptyState
            icon={CreditCard}
            title="Billing unavailable"
            description={loadError ?? "Your billing details could not be loaded."}
          />
        </div>
      ) : (
        <>
          {actionError && (
            <div
              role="alert"
              style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
              className="rounded-lg px-4 py-3 text-sm"
            >
              {actionError}
            </div>
          )}

          {!data.billingEnabled && (
            <div
              style={{ border: "1px solid #FDE68A", backgroundColor: "#FFFBEB", color: "#92400E" }}
              className="rounded-lg px-4 py-3 text-sm"
            >
              Stripe is not configured on this server. Plan changes are disabled;
              usage and limits below reflect your current tier.
            </div>
          )}

          {/* CURRENT PLAN */}
          <div
            style={{ backgroundColor: CARD, borderRadius: "14px", padding: "28px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div className="flex flex-wrap items-center gap-3">
                  <span style={{ color: TEXT_PRIMARY }} className="text-3xl font-bold tracking-tight">
                    {plan.name}
                  </span>
                  <span
                    style={{ backgroundColor: `${planColor}1A`, color: planColor }}
                    className="rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide"
                  >
                    {plan.name}
                  </span>
                  <StatusPulseBadge status={data.subscription.status} />
                  {data.subscription.cancel_at_period_end && (
                    <span
                      style={{ backgroundColor: "#FEF3C7", color: "#B45309" }}
                      className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                    >
                      Cancels at period end
                    </span>
                  )}
                </div>
                <p style={{ color: TEXT_SECONDARY }} className="mt-2 text-sm">
                  {plan.tagline}
                </p>
              </div>
              {hasActiveSub && (
                <Button variant="secondary" onClick={() => void openPortal()} isLoading={busy} disabled={!data.billingEnabled}>
                  <CreditCard className="h-4 w-4" aria-hidden />
                  Manage billing
                </Button>
              )}
            </div>

            <div className="mt-6 flex flex-wrap items-end gap-10">
              <div>
                <p style={{ color: TEXT_MUTED }} className="text-xs font-semibold uppercase tracking-wide">
                  Price
                </p>
                <p style={{ color: TEXT_PRIMARY }} className="mt-1 text-2xl font-bold">
                  {formatCurrency(plan.monthlyPrice)}
                  <span style={{ color: TEXT_SECONDARY }} className="text-sm font-normal">
                    /month
                  </span>
                </p>
              </div>
              <div>
                <p style={{ color: TEXT_MUTED }} className="text-xs font-semibold uppercase tracking-wide">
                  Renewal date
                </p>
                <p style={{ color: TEXT_PRIMARY }} className="mt-1 text-base font-semibold">
                  {data.subscription.current_period_end
                    ? formatDate(data.subscription.current_period_end)
                    : "—"}
                </p>
              </div>
            </div>

            <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "20px" }} className="mt-6">
              <p style={{ color: TEXT_MUTED }} className="mb-3 text-xs font-semibold uppercase tracking-wide">
                What&apos;s included
              </p>
              <ul className="grid gap-2 sm:grid-cols-2">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm" style={{ color: "#334155" }}>
                    <Check className="mt-0.5 h-4 w-4 shrink-0" style={{ color: planColor }} aria-hidden />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* USAGE METRICS */}
          <SectionCard
            title="Usage metrics"
            description="Live usage against your plan's limits. AutoApply has no plan-tiered cap - shown as an informational count."
          >
            <div className="grid gap-6 sm:grid-cols-2">
              <UsageStatBar
                label="Applications"
                current={usage?.resources.applications?.current ?? 0}
                limit={usage?.resources.applications?.limit ?? 0}
                period={usage?.resources.applications?.period}
              />
              <UsageStatBar
                label="Agent runs"
                current={usage?.resources.agent_runs?.current ?? data.usage.agent_runs.used}
                limit={usage?.resources.agent_runs?.limit ?? data.usage.agent_runs.limit}
                period={usage?.resources.agent_runs?.period ?? "today"}
              />
              <UsageStatCount
                label="AutoApply submissions"
                value={data.autoapplySubmissionsThisMonth}
                hint="This month · no plan limit"
              />
              <UsageStatBar
                label="Storage used"
                current={usage?.resources.storage_mb?.current ?? data.usage.storage_mb.used}
                limit={usage?.resources.storage_mb?.limit ?? data.usage.storage_mb.limit}
                unit="MB"
                period="current"
              />
            </div>
          </SectionCard>

          {/* PLAN COMPARISON */}
          <SectionCard
            title="Plans"
            description="Upgrade or downgrade your subscription at any time."
          >
            <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
              {SUBSCRIPTION_TIERS.map((tier) => (
                <PlanCard
                  key={tier}
                  tier={tier}
                  currentTier={data.subscription.tier}
                  onSelect={(t) => void startCheckout(t)}
                  busy={busy || !data.billingEnabled}
                />
              ))}
            </div>
          </SectionCard>

          {/* BILLING HISTORY */}
          <SectionCard title="Billing history" description="Your past invoices.">
            {data.invoices.length === 0 ? (
              <EmptyState
                icon={ReceiptText}
                title="No invoices yet"
                description="Invoices will appear here once you subscribe to a paid plan."
              />
            ) : (
              <Table
                columns={invoiceColumns}
                data={data.invoices}
                rowKey={(row) => row.id}
                pageSize={10}
              />
            )}
          </SectionCard>
        </>
      )}
    </div>
  );
}
