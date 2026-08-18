"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  Save,
  TrendingUp,
  Zap,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

// ---------- Types ----------

interface UsageRecord {
  automated_count: number;
  email_count: number;
  manual_count: number;
  overage_automated: number;
  overage_email: number;
  overage_cost: number;
  api_cost_claude: number;
  api_cost_openai: number;
  proxy_cost: number;
  captcha_cost: number;
  using_own_keys: boolean;
}

interface TierRecord {
  monthly_automated: number;
  monthly_email: number;
  monthly_manual: number;
  daily_max: number;
  allow_own_keys: boolean;
}

interface DailyPoint {
  date: string;
  automated: number;
}

interface KeysResponse {
  using_own_keys: boolean;
  has_anthropic: boolean;
  has_openai: boolean;
}

// ---------- Constants ----------

const TIER_LABELS: Record<string, string> = {
  starter: "Starter",
  professional: "Professional",
  enterprise: "Enterprise",
  consultant: "Consultant",
};

const TIER_BADGE_COLOR: Record<string, BadgeColor> = {
  starter: "gray",
  professional: "blue",
  enterprise: "teal",
  consultant: "purple",
};

const NEXT_TIER: Record<string, string> = {
  starter: "professional",
  professional: "enterprise",
};

const NEXT_TIER_LIMITS: Record<string, { automated: number; email: number }> = {
  professional: { automated: 200, email: 100 },
  enterprise: { automated: 1000, email: 500 },
};

// ---------- Helpers ----------

function pct(count: number, limit: number): number {
  if (limit < 0) return 0;
  if (limit === 0) return 100;
  return Math.min(100, Math.round((count / limit) * 100));
}

function progressBarClass(p: number): string {
  if (p >= 100) return "bg-red-500";
  if (p >= 80) return "bg-amber-400";
  return "bg-teal-500";
}

function progressTrackClass(p: number): string {
  if (p >= 100) return "bg-red-100";
  if (p >= 80) return "bg-amber-100";
  return "bg-navy-100";
}

function limitLabel(n: number): string {
  return n < 0 ? "∞" : n.toLocaleString();
}

function fmtUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

const C = {
  teal: "#2dd4bf",
  grid: "rgba(0,0,0,0.06)",
  axis: "#8a93b6",
  limit: "#f87171",
} as const;

const AXIS_TICK = { fill: C.axis, fontSize: 11 };
const TOOLTIP_STYLE = {
  backgroundColor: "#14143a",
  border: "1px solid rgba(255,255,255,0.12)",
  borderRadius: 10,
  fontSize: 12,
  color: "#e2e8f0",
};

// ---------- Inline chart ----------

function DailyChart({
  data,
  dailyMax,
}: {
  data: DailyPoint[];
  dailyMax: number;
}) {
  if (data.length === 0) {
    return (
      <p className="py-8 text-center text-sm text-navy-400">
        No submissions recorded this month yet.
      </p>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" tick={AXIS_TICK} tickLine={false} axisLine={false} />
        <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "rgba(0,0,0,0.04)" }} />
        {dailyMax > 0 && (
          <ReferenceLine
            y={dailyMax}
            stroke={C.limit}
            strokeDasharray="4 2"
            label={{
              value: `Daily limit (${dailyMax})`,
              position: "insideTopRight",
              fill: C.limit,
              fontSize: 11,
            }}
          />
        )}
        <Bar dataKey="automated" name="Submissions" fill={C.teal} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

// ---------- Sub-components ----------

function StatCard({
  label,
  count,
  limit,
  usedPct,
}: {
  label: string;
  count: number;
  limit: number;
  usedPct: number;
}) {
  const isUnlimited = limit < 0;
  return (
    <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-navy-400">{label}</p>
      <div className="mt-2 flex items-baseline gap-1">
        <span className="text-2xl font-semibold text-navy-900">
          {count.toLocaleString()}
        </span>
        <span className="text-sm text-navy-400">/ {limitLabel(limit)}</span>
      </div>
      {isUnlimited ? (
        <p className="mt-3 text-xs text-teal-600">Unlimited on your plan</p>
      ) : (
        <>
          <div className={`mt-3 h-1.5 w-full rounded-full ${progressTrackClass(usedPct)}`}>
            <div
              className={`h-1.5 rounded-full transition-all ${progressBarClass(usedPct)}`}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <p className="mt-1.5 text-right text-xs text-navy-400">{usedPct}% used</p>
        </>
      )}
    </div>
  );
}

function CostRow({ label, amount }: { label: string; amount: number }) {
  return (
    <tr>
      <td className="py-2.5 pr-4 text-navy-700">{label}</td>
      <td className="py-2.5 text-right text-navy-900">{fmtUsd(amount)}</td>
    </tr>
  );
}

function LegendDot({
  color,
  label,
  dashed,
}: {
  color: string;
  label: string;
  dashed?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      {dashed ? (
        <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-red-400" />
      ) : (
        <span className={`inline-block h-2.5 w-2.5 rounded-sm ${color}`} />
      )}
      {label}
    </span>
  );
}

// ---------- Main page ----------

export default function UsagePage() {
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<UsageRecord | null>(null);
  const [limits, setLimits] = useState<TierRecord | null>(null);
  const [tier, setTier] = useState("starter");
  const [dailyData, setDailyData] = useState<DailyPoint[]>([]);

  // API key state
  const [usingOwnKeys, setUsingOwnKeys] = useState(false);
  const [anthropicKey, setAnthropicKey] = useState("");
  const [openaiKey, setOpenaiKey] = useState("");
  const [showAnthropicKey, setShowAnthropicKey] = useState(false);
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [savingAnthropicKey, setSavingAnthropicKey] = useState(false);
  const [savingOpenaiKey, setSavingOpenaiKey] = useState(false);
  const [savedAnthropicKey, setSavedAnthropicKey] = useState(false);
  const [savedOpenaiKey, setSavedOpenaiKey] = useState(false);
  const [keysLoaded, setKeysLoaded] = useState(false);
  const [toggleLoading, setToggleLoading] = useState(false);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();

      // Org + tier
      const { data: orgData } = await supabase
        .from("organizations")
        .select("subscription_tier")
        .single();

      const orgTier = orgData?.subscription_tier ?? "starter";
      setTier(orgTier);

      // Current period usage
      const now = new Date();
      const periodStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
      const periodEnd = new Date(
        now.getFullYear(),
        now.getMonth() + 1,
        0,
        23,
        59,
        59,
      ).toISOString();

      const { data: usageData } = await supabase
        .from("submission_usage")
        .select("*")
        .gte("period_start", periodStart)
        .lte("period_end", periodEnd)
        .maybeSingle();

      setUsage(usageData ?? null);

      // Tier limits
      const { data: limitsData } = await supabase
        .from("tier_limits")
        .select("*")
        .eq("tier_name", orgTier)
        .maybeSingle();

      setLimits(limitsData ?? null);

      // Daily submissions (group by day client-side)
      const { data: submissions } = await supabase
        .from("autoapply_submissions")
        .select("created_at")
        .gte("created_at", periodStart)
        .lte("created_at", periodEnd);

      const dailyMap: Record<string, number> = {};
      // Pre-populate days up to today
      for (let d = 1; d <= now.getDate(); d++) {
        const key = `${now.getMonth() + 1}/${d}`;
        dailyMap[key] = 0;
      }
      for (const sub of submissions ?? []) {
        const dt = new Date(sub.created_at);
        const key = `${dt.getMonth() + 1}/${dt.getDate()}`;
        dailyMap[key] = (dailyMap[key] ?? 0) + 1;
      }
      setDailyData(
        Object.entries(dailyMap)
          .map(([date, automated]) => ({ date, automated }))
          .sort((a, b) => {
            const [am = 0, ad = 0] = a.date.split("/").map(Number);
            const [bm = 0, bd = 0] = b.date.split("/").map(Number);
            return am !== bm ? am - bm : ad - bd;
          }),
      );

      // Own API key status
      const keysRes = await fetch("/api/autoapply/usage/keys");
      if (keysRes.ok) {
        const keysJson = (await keysRes.json()) as KeysResponse;
        setUsingOwnKeys(keysJson.using_own_keys);
        if (keysJson.has_anthropic) setAnthropicKey("••••••••••••••••");
        if (keysJson.has_openai) setOpenaiKey("••••••••••••••••");
        setKeysLoaded(true);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  async function handleSaveKey(type: "anthropic" | "openai") {
    const key = type === "anthropic" ? anthropicKey : openaiKey;
    if (!key || key.includes("•")) return;
    if (type === "anthropic") setSavingAnthropicKey(true);
    else setSavingOpenaiKey(true);
    try {
      const res = await fetch("/api/autoapply/usage/keys", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type, key }),
      });
      if (res.ok) {
        if (type === "anthropic") {
          setSavedAnthropicKey(true);
          setAnthropicKey("••••••••••••••••");
          setTimeout(() => setSavedAnthropicKey(false), 3000);
        } else {
          setSavedOpenaiKey(true);
          setOpenaiKey("••••••••••••••••");
          setTimeout(() => setSavedOpenaiKey(false), 3000);
        }
      }
    } finally {
      if (type === "anthropic") setSavingAnthropicKey(false);
      else setSavingOpenaiKey(false);
    }
  }

  async function handleToggleOwnKeys() {
    const next = !usingOwnKeys;
    setToggleLoading(true);
    setUsingOwnKeys(next);
    try {
      await fetch("/api/autoapply/usage/keys", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ using_own_keys: next }),
      });
    } finally {
      setToggleLoading(false);
    }
  }

  // Derived values
  const autoLimit = limits?.monthly_automated ?? 50;
  const emailLimit = limits?.monthly_email ?? 20;
  const manualLimit = limits?.monthly_manual ?? 10;

  const autoPct = pct(usage?.automated_count ?? 0, autoLimit);
  const emailPct = pct(usage?.email_count ?? 0, emailLimit);
  const manualPct = pct(usage?.manual_count ?? 0, manualLimit);

  const totalOverageCount =
    (usage?.overage_automated ?? 0) + (usage?.overage_email ?? 0);

  const totalCost =
    (usage?.api_cost_claude ?? 0) +
    (usage?.api_cost_openai ?? 0) +
    (usage?.proxy_cost ?? 0) +
    (usage?.captcha_cost ?? 0);

  const showCosts = totalOverageCount > 0 || (usage?.using_own_keys ?? false);
  const isEnterpriseOrConsultant =
    tier === "enterprise" || tier === "consultant";
  const nextTier = NEXT_TIER[tier];
  const showUpgrade =
    !!nextTier && (autoPct >= 80 || emailPct >= 80);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-10 text-sm text-navy-400">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading usage data…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/autoapply"
          className="flex items-center gap-1.5 text-sm text-navy-400 hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to AutoApply
        </Link>
      </div>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-primary">
            Usage &amp; Billing
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Monitor your AutoApply submission usage and API costs for this
            billing period.
          </p>
        </div>
        <Badge color={TIER_BADGE_COLOR[tier] ?? "gray"}>
          {TIER_LABELS[tier] ?? tier}
        </Badge>
      </div>

      {/* Monthly Overview */}
      <div>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-navy-400">
          This Month
        </h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Automated"
            count={usage?.automated_count ?? 0}
            limit={autoLimit}
            usedPct={autoPct}
          />
          <StatCard
            label="Email"
            count={usage?.email_count ?? 0}
            limit={emailLimit}
            usedPct={emailPct}
          />
          <StatCard
            label="Manual"
            count={usage?.manual_count ?? 0}
            limit={manualLimit}
            usedPct={manualPct}
          />
        </div>

        {totalOverageCount > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            <TrendingUp className="h-4 w-4 flex-shrink-0" />
            <span>
              Overages this period:{" "}
              <span className="font-semibold">
                {totalOverageCount} submissions
              </span>
              {(usage?.overage_cost ?? 0) > 0 && (
                <span className="ml-1">({fmtUsd(usage?.overage_cost ?? 0)})</span>
              )}
            </span>
          </div>
        )}
      </div>

      {/* Daily Usage Chart */}
      <Card
        title="Daily Submissions"
        description="Total submissions per day for the current month."
      >
        <DailyChart data={dailyData} dailyMax={limits?.daily_max ?? 0} />
        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-navy-500">
          <LegendDot color="bg-teal-400" label="Submissions" />
          {(limits?.daily_max ?? 0) > 0 && (
            <LegendDot
              dashed
              color=""
              label={`Daily limit (${limits?.daily_max ?? 0})`}
            />
          )}
        </div>
      </Card>

      {/* Cost Breakdown */}
      {showCosts && (
        <Card
          title="Cost Breakdown"
          description="API and infrastructure costs this billing period."
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-sidebar text-left text-xs font-medium uppercase tracking-wide text-white">
                  <th className="px-3 py-2 pr-4">Category</th>
                  <th className="px-3 py-2 text-right">Cost</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                <CostRow label="Claude API" amount={usage?.api_cost_claude ?? 0} />
                <CostRow label="OpenAI API" amount={usage?.api_cost_openai ?? 0} />
                <CostRow label="Proxy Network" amount={usage?.proxy_cost ?? 0} />
                <CostRow label="CAPTCHA Solving" amount={usage?.captcha_cost ?? 0} />
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-navy-200">
                  <td className="pt-3 text-sm font-semibold text-navy-900">
                    Total
                  </td>
                  <td className="pt-3 text-right text-sm font-semibold text-navy-900">
                    {fmtUsd(totalCost)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}

      {/* API Key Management — Enterprise / Consultant only */}
      {isEnterpriseOrConsultant && (
        <Card
          title="Your Own API Keys"
          description="Use your own Anthropic and OpenAI keys so AI costs don't count against your allocation."
        >
          {/* Toggle */}
          <div className="mb-5 flex items-center justify-between rounded-lg border border-navy-100 bg-navy-50 px-4 py-3">
            <div>
              <p className="text-sm font-medium text-navy-900">
                {usingOwnKeys
                  ? "Using your own keys — AI costs not counted against allocation"
                  : "Using Benavora platform keys"}
              </p>
              <p className="mt-0.5 text-xs text-navy-500">
                {usingOwnKeys
                  ? "API calls are billed directly to your Anthropic / OpenAI accounts."
                  : "AI API costs are included in your Enterprise/Consultant allocation."}
              </p>
            </div>
            <button
              type="button"
              disabled={toggleLoading}
              onClick={() => void handleToggleOwnKeys()}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-2 disabled:opacity-60 ${
                usingOwnKeys ? "bg-teal-500" : "bg-navy-200"
              }`}
              aria-label="Toggle own API keys"
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-surface shadow ring-0 transition duration-200 ease-in-out ${
                  usingOwnKeys ? "translate-x-5" : "translate-x-0"
                }`}
              />
            </button>
          </div>

          <div className="space-y-4">
            {/* Anthropic Key */}
            <div>
              <label
                htmlFor="anthropicKey"
                className="block text-xs font-medium text-navy-700"
              >
                Anthropic API Key
              </label>
              <div className="mt-1 flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="anthropicKey"
                    type={showAnthropicKey ? "text" : "password"}
                    value={anthropicKey}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    placeholder="sk-ant-…"
                    className="block w-full rounded-md border border-navy-200 bg-surface px-3 py-2 pr-9 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowAnthropicKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-700"
                    aria-label={showAnthropicKey ? "Hide key" : "Show key"}
                  >
                    {showAnthropicKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  onClick={() => void handleSaveKey("anthropic")}
                  isLoading={savingAnthropicKey}
                  disabled={
                    savingAnthropicKey ||
                    !anthropicKey ||
                    anthropicKey.includes("•")
                  }
                >
                  {savedAnthropicKey ? (
                    <CheckCircle2 className="h-4 w-4 text-teal-500" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {savedAnthropicKey ? "Saved" : "Save"}
                </Button>
              </div>
            </div>

            {/* OpenAI Key */}
            <div>
              <label
                htmlFor="openaiKey"
                className="block text-xs font-medium text-navy-700"
              >
                OpenAI API Key
              </label>
              <div className="mt-1 flex gap-2">
                <div className="relative flex-1">
                  <input
                    id="openaiKey"
                    type={showOpenaiKey ? "text" : "password"}
                    value={openaiKey}
                    onChange={(e) => setOpenaiKey(e.target.value)}
                    placeholder="sk-…"
                    className="block w-full rounded-md border border-navy-200 bg-surface px-3 py-2 pr-9 text-sm text-navy-900 shadow-sm focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400"
                  />
                  <button
                    type="button"
                    onClick={() => setShowOpenaiKey((v) => !v)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-navy-400 hover:text-navy-700"
                    aria-label={showOpenaiKey ? "Hide key" : "Show key"}
                  >
                    {showOpenaiKey ? (
                      <EyeOff className="h-4 w-4" />
                    ) : (
                      <Eye className="h-4 w-4" />
                    )}
                  </button>
                </div>
                <Button
                  onClick={() => void handleSaveKey("openai")}
                  isLoading={savingOpenaiKey}
                  disabled={
                    savingOpenaiKey || !openaiKey || openaiKey.includes("•")
                  }
                >
                  {savedOpenaiKey ? (
                    <CheckCircle2 className="h-4 w-4 text-teal-500" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  {savedOpenaiKey ? "Saved" : "Save"}
                </Button>
              </div>
            </div>
          </div>

          {keysLoaded && (
            <div className="mt-4 flex items-center gap-2 rounded-md border border-navy-100 bg-navy-50 px-3 py-2 text-xs text-navy-500">
              <Zap className="h-3.5 w-3.5 flex-shrink-0 text-teal-500" />
              {usingOwnKeys
                ? "Your own keys are active. AI costs are not counted against your monthly allocation."
                : "Enable the toggle above to activate your own keys."}
            </div>
          )}
        </Card>
      )}

      {/* Upgrade Prompt */}
      {showUpgrade && nextTier && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-5 py-4">
          <p className="text-sm font-semibold text-blue-900">
            Running low on submissions?
          </p>
          <p className="mt-1 text-sm text-blue-700">
            Upgrade to{" "}
            <span className="font-semibold">
              {TIER_LABELS[nextTier] ?? nextTier}
            </span>{" "}
            for{" "}
            {(
              NEXT_TIER_LIMITS[nextTier]?.automated ?? 0
            ).toLocaleString()}{" "}
            automated and{" "}
            {(NEXT_TIER_LIMITS[nextTier]?.email ?? 0).toLocaleString()} email
            submissions per month.
          </p>
          <div className="mt-3">
            <Link
              href="/settings/billing"
              className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              Upgrade to {TIER_LABELS[nextTier] ?? nextTier}
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
