"use client";

// "Discover" — a consumer-friendly alternative to the taxonomy-search-driven
// "New Discovery" wizard (../new/page.tsx). Instead of searching NAICS/civic
// taxonomy nodes by trade name, this flow picks from a small curated set of
// plain-English business categories (src/lib/donor-discovery/naics-labels.ts)
// and previews real nearby businesses before committing to a discovery run.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Building2,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Cpu,
  ExternalLink,
  HardHat,
  HeartPulse,
  Landmark,
  Loader2,
  MapPin,
  Package,
  Phone,
  Recycle,
  Rocket,
  Scissors,
  Search,
  Star,
  Truck,
  Users,
  Utensils,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { useProfile } from "@/lib/hooks/useProfile";
import { createClient } from "@/lib/supabase/client";
import { NAICS_CATEGORIES, naicsLabel } from "@/lib/donor-discovery/naics-labels";
import { cn } from "@/lib/utils/cn";

const STEPS = [
  { id: 1, title: "Business Type" },
  { id: 2, title: "Search Area" },
  { id: 3, title: "Preview & Launch" },
] as const;

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  construction: HardHat,
  waste_environmental: Recycle,
  automotive: Car,
  financial: Landmark,
  food: Utensils,
  real_estate: Building2,
  professional: Briefcase,
  staffing: Users,
  retail: Package,
  healthcare: HeartPulse,
  technology: Cpu,
  personal_care: Scissors,
  logistics: Truck,
};

// One distinct hex accent per category card — inline hex only, per the
// design system (no Tailwind color classes for anything data-driven).
const CATEGORY_ACCENTS: Record<string, string> = {
  construction: "#F97316",
  waste_environmental: "#10B981",
  automotive: "#EF4444",
  financial: "#0EA5E9",
  food: "#F59E0B",
  real_estate: "#8B5CF6",
  professional: "#0077B6",
  staffing: "#EC4899",
  retail: "#6366F1",
  healthcare: "#14B8A6",
  technology: "#6B7280",
  personal_care: "#A855F7",
  logistics: "#84CC16",
};
const DEFAULT_CATEGORY_ACCENT = "#0077B6";

const RADIUS_OPTIONS = [10, 25, 50, 100] as const;

// Applied against the real `rating` Google Places returns (see
// discover/route.ts's minRating handling) — not a fabricated filter.
const MIN_RATING_OPTIONS = [
  { value: "0", label: "Any rating" },
  { value: "3", label: "3.0+ stars" },
  { value: "4", label: "4.0+ stars" },
  { value: "4.5", label: "4.5+ stars" },
];

interface DiscoverProspect {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  rating: number | null;
  lat: number | null;
  lng: number | null;
}

interface OrgSearchLocation {
  addressLine: string | null;
  serviceArea: string | null;
}

interface LaunchedProspectDirectory {
  legal_name: string;
  dba_name: string | null;
  website: string | null;
  enrichment: Record<string, unknown> | null;
}

interface LaunchedProspect {
  id: string;
  directory: LaunchedProspectDirectory | null;
}

interface RouteResult {
  ok: boolean;
  message: string;
}

export default function DiscoverPage() {
  const router = useRouter();
  const { profile } = useProfile();

  const [step, setStep] = useState(1);

  // Step 1 — business type
  const [selectedCategoryKey, setSelectedCategoryKey] = useState<string | null>(null);
  const [selectedCode, setSelectedCode] = useState<string | null>(null);

  // Step 2 — search parameters
  const [radiusMiles, setRadiusMiles] = useState<number>(25);
  const [keywords, setKeywords] = useState("");
  const [minRating, setMinRating] = useState("0");
  const [orgLocation, setOrgLocation] = useState<OrgSearchLocation | null>(null);
  const [orgLocationLoading, setOrgLocationLoading] = useState(true);

  // Step 3 — preview + launch
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [prospects, setProspects] = useState<DiscoverProspect[] | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchResult, setLaunchResult] = useState<{ requestId: string; prospectsCreated: number } | null>(
    null,
  );

  // Post-launch — real persisted prospects (with ids) for the AutoApply /
  // Email Campaign routing actions. Preview-stage prospects are raw Google
  // Places results with no database row yet, so routing only becomes
  // possible once a discovery run has actually been launched.
  const [launchedProspects, setLaunchedProspects] = useState<LaunchedProspect[] | null>(null);
  const [loadingLaunchedProspects, setLoadingLaunchedProspects] = useState(false);
  const [selectedProspectIds, setSelectedProspectIds] = useState<Set<string>>(new Set());
  const [busyProspectIds, setBusyProspectIds] = useState<Set<string>>(new Set());
  const [rowFeedback, setRowFeedback] = useState<Record<string, RouteResult>>({});
  const [batchAutoApplyLoading, setBatchAutoApplyLoading] = useState(false);
  const [batchEmailLoading, setBatchEmailLoading] = useState(false);
  const [batchFeedback, setBatchFeedback] = useState<string | null>(null);

  const categories = useMemo(() => Object.entries(NAICS_CATEGORIES), []);

  // "Use My Service Area" — discover/route.ts always searches near the org's
  // address_line1/city/state/zip (the only geography source this flow has;
  // there's no per-request address override). This just surfaces that real
  // address plus the org's `service_area` free-text field (migration
  // 001_initial_schema.sql) so the step isn't a silent assumption.
  useEffect(() => {
    if (!profile?.organization_id) return;
    let active = true;
    (async () => {
      const supabase = createClient();
      const { data } = await supabase
        .from("organizations")
        .select("address_line1, address_line2, city, state, zip, service_area")
        .eq("id", profile.organization_id)
        .maybeSingle();
      if (!active) return;
      if (data) {
        const addressLine = [data.address_line1, data.address_line2, data.city, data.state, data.zip]
          .filter((part): part is string => Boolean(part && part.trim().length > 0))
          .join(", ");
        setOrgLocation({
          addressLine: addressLine.length > 0 ? addressLine : null,
          serviceArea: data.service_area,
        });
      }
      setOrgLocationLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [profile?.organization_id]);

  const step1Valid = selectedCode !== null;
  const step2Valid = RADIUS_OPTIONS.includes(radiusMiles as (typeof RADIUS_OPTIONS)[number]);

  function selectCategory(key: string) {
    setSelectedCategoryKey(key);
    setSelectedCode(null);
  }

  async function runPreview() {
    if (!profile?.organization_id || !selectedCode) return;
    setPreviewLoading(true);
    setPreviewError(null);
    setLaunchError(null);
    setLaunchResult(null);
    setLaunchedProspects(null);
    setSelectedProspectIds(new Set());
    setRowFeedback({});
    setBatchFeedback(null);
    try {
      const res = await fetch("/api/donor-discovery/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          naicsCode: selectedCode,
          radius: radiusMiles,
          keywords: keywords.trim() || undefined,
          orgId: profile.organization_id,
          minRating: Number(minRating) > 0 ? Number(minRating) : undefined,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        prospects?: DiscoverProspect[];
        error?: string;
      };
      if (!res.ok) {
        setPreviewError(payload.error ?? "Could not search for businesses.");
        setProspects(null);
      } else {
        setProspects(payload.prospects ?? []);
      }
    } catch {
      setPreviewError("Could not reach the server. Please try again.");
      setProspects(null);
    }
    setPreviewLoading(false);
  }

  async function handleContinueToPreview() {
    setStep(3);
    await runPreview();
  }

  async function handleLaunch() {
    if (!profile?.organization_id || !selectedCode) return;
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await fetch("/api/donor-discovery/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          naicsCode: selectedCode,
          radius: radiusMiles,
          keywords: keywords.trim() || undefined,
          orgId: profile.organization_id,
          minRating: Number(minRating) > 0 ? Number(minRating) : undefined,
          launch: true,
        }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        requestId?: string;
        prospectsCreated?: number;
        error?: string;
      };
      if (!res.ok || !payload.requestId) {
        setLaunchError(payload.error ?? "Failed to launch this discovery run.");
        setLaunching(false);
        return;
      }
      setLaunchResult({ requestId: payload.requestId, prospectsCreated: payload.prospectsCreated ?? 0 });
      await loadLaunchedProspects(payload.requestId);
    } catch {
      setLaunchError("Could not reach the server. Please try again.");
    }
    setLaunching(false);
  }

  async function loadLaunchedProspects(requestId: string) {
    setLoadingLaunchedProspects(true);
    try {
      const res = await fetch(
        `/api/donor-discovery/prospects?request_id=${encodeURIComponent(requestId)}&limit=100`,
      );
      const payload = (await res.json().catch(() => ({}))) as { data?: LaunchedProspect[] };
      setLaunchedProspects(res.ok ? (payload.data ?? []) : []);
    } catch {
      setLaunchedProspects([]);
    }
    setLoadingLaunchedProspects(false);
  }

  function toggleProspectSelected(id: string) {
    setSelectedProspectIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function routeProspectToAutoApply(id: string): Promise<RouteResult> {
    try {
      const res = await fetch(`/api/donor-discovery/prospects/${id}/route-to-autoapply`, {
        method: "POST",
      });
      const payload = (await res.json().catch(() => ({}))) as {
        queued?: boolean;
        reason?: string;
        error?: string;
      };
      if (!res.ok) return { ok: false, message: payload.error ?? "Failed to queue this prospect." };
      if (payload.queued) return { ok: true, message: "Queued in AutoApply." };
      return {
        ok: false,
        message:
          payload.reason === "no_giving_form"
            ? "No donation form found for this business."
            : "Could not queue this prospect.",
      };
    } catch {
      return { ok: false, message: "Could not reach the server." };
    }
  }

  async function routeProspectToEmail(id: string): Promise<RouteResult> {
    try {
      const res = await fetch(`/api/donor-discovery/prospects/${id}/route-to-email`, {
        method: "POST",
      });
      const payload = (await res.json().catch(() => ({}))) as { campaignId?: string; error?: string };
      if (!res.ok || !payload.campaignId) {
        return { ok: false, message: payload.error ?? "Failed to add this prospect to a campaign." };
      }
      return { ok: true, message: "Added to email campaign." };
    } catch {
      return { ok: false, message: "Could not reach the server." };
    }
  }

  async function handleRowAction(id: string, action: "autoapply" | "email") {
    setBusyProspectIds((prev) => new Set(prev).add(id));
    const result = action === "autoapply" ? await routeProspectToAutoApply(id) : await routeProspectToEmail(id);
    setRowFeedback((prev) => ({ ...prev, [id]: result }));
    setBusyProspectIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

  async function handleBatchRoute(action: "autoapply" | "email") {
    const ids = [...selectedProspectIds];
    if (ids.length === 0) return;
    const setLoading = action === "autoapply" ? setBatchAutoApplyLoading : setBatchEmailLoading;
    setLoading(true);
    setBatchFeedback(null);
    setBusyProspectIds((prev) => new Set([...prev, ...ids]));

    const results = await Promise.all(
      ids.map(async (id) => ({
        id,
        result: action === "autoapply" ? await routeProspectToAutoApply(id) : await routeProspectToEmail(id),
      })),
    );

    setRowFeedback((prev) => {
      const next = { ...prev };
      for (const { id, result } of results) next[id] = result;
      return next;
    });
    setBusyProspectIds((prev) => {
      const next = new Set(prev);
      for (const { id } of results) next.delete(id);
      return next;
    });

    const succeeded = results.filter((r) => r.result.ok).length;
    const failed = results.length - succeeded;
    setBatchFeedback(
      action === "autoapply"
        ? `${succeeded} prospect${succeeded === 1 ? "" : "s"} sent to AutoApply${failed ? `, ${failed} skipped` : ""}.`
        : `${succeeded} prospect${succeeded === 1 ? "" : "s"} added to the email campaign${failed ? `, ${failed} skipped` : ""}.`,
    );
    setSelectedProspectIds(new Set());
    setLoading(false);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover"
        description="Find nearby businesses by industry, preview real results, then add them to your prospect pipeline."
      />

      {/* Step indicator */}
      <div className="flex items-center justify-between">
        {STEPS.map((s, i) => {
          const done = step > s.id;
          const active = step === s.id;
          return (
            <div key={s.id} className="flex flex-1 items-center">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                    done
                      ? "bg-[#00B4D8] text-white"
                      : active
                        ? "bg-[#0077B6] text-white"
                        : "bg-slate-100 text-slate-400",
                  )}
                >
                  {done ? <Check className="h-3.5 w-3.5" aria-hidden /> : s.id}
                </span>
                <span className={cn("text-sm font-medium", active ? "text-slate-900" : "text-slate-400")}>
                  {s.title}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className={cn("mx-3 h-0.5 flex-1", done ? "bg-[#00B4D8]" : "bg-slate-200")} aria-hidden />
              )}
            </div>
          );
        })}
      </div>

      {/* Step 1: business type */}
      {step === 1 && (
        <Card
          title="What kind of business are you looking for?"
          description="Pick a category, then a specific business type within it."
        >
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {categories.map(([key, category]) => {
              const Icon = CATEGORY_ICONS[key] ?? Briefcase;
              const accent = CATEGORY_ACCENTS[key] ?? DEFAULT_CATEGORY_ACCENT;
              const active = selectedCategoryKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectCategory(key)}
                  style={
                    active
                      ? { borderColor: accent, backgroundColor: `${accent}0D`, boxShadow: `0 0 0 1px ${accent}4D` }
                      : undefined
                  }
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition",
                    active ? "" : "border-slate-200 bg-white hover:shadow-md",
                  )}
                >
                  <span
                    style={{
                      backgroundColor: active ? accent : `${accent}1A`,
                      color: active ? "#FFFFFF" : accent,
                    }}
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                  >
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <span className="text-sm font-semibold text-slate-900">{category.label}</span>
                  <span className="text-xs text-slate-400">
                    {category.codes.length} business type{category.codes.length === 1 ? "" : "s"}
                  </span>
                </button>
              );
            })}
          </div>

          {selectedCategoryKey && (
            <div className="mt-5 border-t border-slate-100 pt-5">
              <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">
                {NAICS_CATEGORIES[selectedCategoryKey]?.label} — pick one
              </p>
              <div className="flex flex-wrap gap-2">
                {NAICS_CATEGORIES[selectedCategoryKey]?.codes.map((code) => {
                  const accent = CATEGORY_ACCENTS[selectedCategoryKey] ?? DEFAULT_CATEGORY_ACCENT;
                  const codeActive = selectedCode === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setSelectedCode(code)}
                      style={
                        codeActive
                          ? { borderColor: accent, backgroundColor: accent, color: "#FFFFFF" }
                          : { borderColor: "#E2E8F0", color: "#475569" }
                      }
                      className="rounded-full border bg-white px-3 py-1.5 text-sm font-medium transition"
                    >
                      {naicsLabel(code)}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Step 2: search parameters */}
      {step === 2 && (
        <Card title="Set your search area" description="We'll search near your organization's address.">
          <div className="space-y-5">
            <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <span
                style={{ backgroundColor: "#0077B61A", color: "#0077B6" }}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              >
                <MapPin className="h-4.5 w-4.5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-slate-900">Using your service area</p>
                {orgLocationLoading ? (
                  <p className="mt-0.5 text-xs text-slate-400">Loading your organization's address…</p>
                ) : orgLocation?.addressLine ? (
                  <>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Searching near <span className="font-medium text-slate-700">{orgLocation.addressLine}</span>
                    </p>
                    {orgLocation.serviceArea && (
                      <p className="mt-1 text-xs text-slate-400">
                        Your organization's stated service area: {orgLocation.serviceArea}
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-0.5 text-xs text-red-500">
                    No address on file — add one in Settings before running Discover, or this search will fail.
                  </p>
                )}
              </div>
            </div>

            <div>
              <p className="mb-2 text-sm font-medium text-slate-700">Radius</p>
              <div className="flex flex-wrap gap-2">
                {RADIUS_OPTIONS.map((mi) => (
                  <button
                    key={mi}
                    type="button"
                    onClick={() => setRadiusMiles(mi)}
                    className={cn(
                      "rounded-lg border px-4 py-2 text-sm font-semibold transition",
                      radiusMiles === mi
                        ? "border-[#0077B6] bg-[#0077B6] text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-[#0077B6] hover:text-[#0077B6]",
                    )}
                  >
                    {mi} mi
                  </button>
                ))}
              </div>
            </div>

            <Input
              label="Keywords (optional)"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. family-owned, veteran-owned"
              helperText="Narrows the search — added to the business type as extra search terms."
            />

            <div className="border-t border-slate-100 pt-5">
              <p className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
                Advanced filters
              </p>
              <Select
                label="Minimum Google rating"
                value={minRating}
                onChange={(e) => setMinRating(e.target.value)}
                options={MIN_RATING_OPTIONS}
                helperText="Filters on Google's real star rating for each business — we don't have employee-count or CSR-program data to filter on yet."
              />
            </div>
          </div>
        </Card>
      )}

      {/* Step 3: preview + launch */}
      {step === 3 && (
        <Card
          title="Preview results"
          description={
            selectedCode
              ? `${naicsLabel(selectedCode)} within ${radiusMiles} miles${keywords.trim() ? ` — "${keywords.trim()}"` : ""}`
              : undefined
          }
        >
          {previewLoading ? (
            <div className="flex items-center justify-center py-10 text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Searching nearby businesses…
            </div>
          ) : previewError ? (
            <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {previewError}
            </div>
          ) : prospects && prospects.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center text-sm text-slate-500">
              <Search className="h-8 w-8 text-slate-300" aria-hidden />
              No businesses found in this area. Try a wider radius or different keywords.
            </div>
          ) : prospects ? (
            <div className="space-y-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                {prospects.length} business{prospects.length === 1 ? "" : "es"} found
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {prospects.map((p) => (
                  <div
                    key={p.placeId}
                    className="rounded-xl border border-slate-200 bg-white p-4 hover:border-[#00B4D8] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{p.name}</p>
                      {p.rating != null && (
                        <span className="flex shrink-0 items-center gap-1 text-xs font-semibold text-amber-600">
                          <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" aria-hidden />
                          {p.rating.toFixed(1)}
                        </span>
                      )}
                    </div>
                    {p.address && <p className="mt-1 text-xs text-slate-500">{p.address}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.phone && (
                        <Badge color="gray">
                          <Phone className="mr-1 inline h-3 w-3" aria-hidden />
                          {p.phone}
                        </Badge>
                      )}
                      {p.website && (
                        <a
                          href={p.website}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="inline-flex items-center"
                        >
                          <Badge color="teal">
                            Website
                            <ExternalLink className="ml-1 inline h-3 w-3" aria-hidden />
                          </Badge>
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {launchError && (
                <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                  {launchError}
                </div>
              )}

              {launchResult && (
                <div className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-sm text-[#15803D]">
                  Added {launchResult.prospectsCreated} new prospect
                  {launchResult.prospectsCreated === 1 ? "" : "s"} to your pipeline.{" "}
                  <button
                    type="button"
                    onClick={() => router.push("/donor-discovery/prospects?stage=new")}
                    className="font-semibold underline"
                  >
                    Review them now
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </Card>
      )}

      {/* Step 3: route new prospects into AutoApply / an email campaign */}
      {step === 3 && launchResult && (
        <Card
          title="Route your new prospects"
          description="Send businesses with a donation form straight to AutoApply, or add any of them to a cold-outreach email campaign."
        >
          {loadingLaunchedProspects ? (
            <div className="flex items-center justify-center py-8 text-sm text-slate-500">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
              Loading your new prospects…
            </div>
          ) : launchedProspects && launchedProspects.length > 0 ? (
            <div className="space-y-3 pb-16">
              {batchFeedback && (
                <div className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-4 py-3 text-sm text-[#15803D]">
                  {batchFeedback}
                </div>
              )}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {launchedProspects.map((p) => {
                  const directory = p.directory;
                  const name = directory?.dba_name?.trim() || directory?.legal_name || "Unknown business";
                  const enrichment = directory?.enrichment ?? {};
                  const hasDonationForm = enrichment.has_donation_form === true;
                  const isBusy = busyProspectIds.has(p.id);
                  const feedback = rowFeedback[p.id];

                  return (
                    <div
                      key={p.id}
                      className="flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4"
                    >
                      <input
                        type="checkbox"
                        checked={selectedProspectIds.has(p.id)}
                        onChange={() => toggleProspectSelected(p.id)}
                        aria-label={`Select ${name}`}
                        className="mt-1 h-4 w-4 rounded border-slate-300 text-[#0077B6] focus:ring-[#0077B6]/30"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900">{name}</p>
                        {directory?.website && (
                          <p className="mt-0.5 truncate text-xs text-slate-400">{directory.website}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2">
                          {hasDonationForm && (
                            <button
                              type="button"
                              onClick={() => void handleRowAction(p.id, "autoapply")}
                              disabled={isBusy}
                              className="rounded-lg bg-[#0077B6] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#005F92] disabled:opacity-60"
                            >
                              Add to AutoApply Queue
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => void handleRowAction(p.id, "email")}
                            disabled={isBusy}
                            className="rounded-lg bg-[#00B4D8] px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-[#0093AC] disabled:opacity-60"
                          >
                            Add to Email Campaign
                          </button>
                          <Link
                            href="/donor-discovery/outreach"
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#8B5CF6] hover:text-[#8B5CF6]"
                          >
                            Quick Outreach
                          </Link>
                          <Link
                            href={`/donor-discovery/prospects/${p.id}`}
                            className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-[#0077B6] hover:text-[#0077B6]"
                          >
                            View Details
                          </Link>
                        </div>
                        {feedback && (
                          <p className={cn("mt-2 text-xs font-medium", feedback.ok ? "text-[#15803D]" : "text-slate-500")}>
                            {feedback.message}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {selectedProspectIds.size > 0 && (
                <div className="fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-xl bg-slate-900 px-6 py-3 shadow-xl">
                  <span className="text-sm font-medium text-white">
                    {selectedProspectIds.size} selected
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleBatchRoute("autoapply")}
                    disabled={batchAutoApplyLoading || batchEmailLoading}
                    className="rounded-lg bg-[#0077B6] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[#005F92] disabled:opacity-60"
                  >
                    {batchAutoApplyLoading
                      ? "Sending…"
                      : `Send ${selectedProspectIds.size} to AutoApply`}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleBatchRoute("email")}
                    disabled={batchAutoApplyLoading || batchEmailLoading}
                    className="rounded-lg bg-[#00B4D8] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[#0093AC] disabled:opacity-60"
                  >
                    {batchEmailLoading
                      ? "Adding…"
                      : `Add ${selectedProspectIds.size} to Email Campaign`}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <p className="py-6 text-center text-sm text-slate-500">
              No new prospects were added to your pipeline this run.
            </p>
          )}
        </Card>
      )}

      {/* Wizard navigation */}
      <div className="flex items-center justify-between border-t border-slate-200 pt-4">
        <Button
          variant="secondary"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || previewLoading || launching}
        >
          <ChevronLeft className="h-4 w-4" aria-hidden />
          Back
        </Button>
        {step === 1 && (
          <Button onClick={() => setStep(2)} disabled={!step1Valid}>
            Continue
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        )}
        {step === 2 && (
          <Button onClick={() => void handleContinueToPreview()} disabled={!step2Valid}>
            Search Businesses
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Button>
        )}
        {step === 3 && (
          <Button
            onClick={() => void handleLaunch()}
            disabled={!prospects || prospects.length === 0 || launching || launchResult !== null}
            isLoading={launching}
          >
            {!launching && <Rocket className="h-4 w-4" aria-hidden />}
            {launching ? "Launching…" : "Launch Discovery"}
          </Button>
        )}
      </div>
    </div>
  );
}
