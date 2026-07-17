"use client";

// "Discover" — a consumer-friendly alternative to the taxonomy-search-driven
// "New Discovery" wizard (../new/page.tsx). Instead of searching NAICS/civic
// taxonomy nodes by trade name, this flow picks from a small curated set of
// plain-English business categories (src/lib/donor-discovery/naics-labels.ts)
// and previews real nearby businesses before committing to a discovery run.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Briefcase,
  Building2,
  Check,
  ChevronLeft,
  ChevronRight,
  Factory,
  HardHat,
  Landmark,
  Loader2,
  Package,
  Phone,
  Rocket,
  Search,
  Utensils,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, Input, Select } from "@/components/ui";
import { useProfile } from "@/lib/hooks/useProfile";
import { NAICS_CATEGORIES, naicsLabel } from "@/lib/donor-discovery/naics-labels";
import { cn } from "@/lib/utils/cn";

const STEPS = [
  { id: 1, title: "Business Type" },
  { id: 2, title: "Search Area" },
  { id: 3, title: "Preview & Launch" },
] as const;

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  construction: HardHat,
  manufacturing: Factory,
  financial: Landmark,
  food: Utensils,
  real_estate: Building2,
  professional: Briefcase,
  retail: Package,
};

const RADIUS_OPTIONS = [10, 25, 50, 100] as const;

const MIN_SIZE_OPTIONS = [
  { value: "any", label: "Any size" },
  { value: "small", label: "Small (1–10 employees)" },
  { value: "medium", label: "Medium (11–50 employees)" },
  { value: "large", label: "Large (51–200 employees)" },
  { value: "enterprise", label: "Enterprise (200+ employees)" },
];

interface DiscoverProspect {
  placeId: string;
  name: string;
  address: string | null;
  phone: string | null;
  website: string | null;
  lat: number | null;
  lng: number | null;
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
  const [minSize, setMinSize] = useState("any");

  // Step 3 — preview + launch
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [prospects, setProspects] = useState<DiscoverProspect[] | null>(null);
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [launchResult, setLaunchResult] = useState<{ requestId: string; prospectsCreated: number } | null>(
    null,
  );

  const categories = useMemo(() => Object.entries(NAICS_CATEGORIES), []);

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
    try {
      const res = await fetch("/api/donor-discovery/discover", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          naicsCode: selectedCode,
          radius: radiusMiles,
          keywords: keywords.trim() || undefined,
          orgId: profile.organization_id,
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
    } catch {
      setLaunchError("Could not reach the server. Please try again.");
    }
    setLaunching(false);
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
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {categories.map(([key, category]) => {
              const Icon = CATEGORY_ICONS[key] ?? Briefcase;
              const active = selectedCategoryKey === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => selectCategory(key)}
                  className={cn(
                    "flex flex-col items-start gap-2 rounded-xl border p-4 text-left transition",
                    active
                      ? "border-[#0077B6] bg-[#EFF6FF] ring-1 ring-[#0077B6]/30"
                      : "border-slate-200 bg-white hover:border-[#00B4D8] hover:shadow-md",
                  )}
                >
                  <span
                    className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-lg",
                      active ? "bg-[#0077B6] text-white" : "bg-slate-100 text-slate-500",
                    )}
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
                {NAICS_CATEGORIES[selectedCategoryKey]?.codes.map((code) => (
                  <button
                    key={code}
                    type="button"
                    onClick={() => setSelectedCode(code)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-sm font-medium transition",
                      selectedCode === code
                        ? "border-[#0077B6] bg-[#0077B6] text-white"
                        : "border-slate-200 bg-white text-slate-600 hover:border-[#0077B6] hover:text-[#0077B6]",
                    )}
                  >
                    {naicsLabel(code)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* Step 2: search parameters */}
      {step === 2 && (
        <Card title="Set your search area" description="We'll search near your organization's address.">
          <div className="space-y-5">
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

            <Select
              label="Minimum company size"
              value={minSize}
              onChange={(e) => setMinSize(e.target.value)}
              options={MIN_SIZE_OPTIONS}
              helperText="Google's business search doesn't report employee counts, so this isn't applied as a hard filter yet — it's recorded for future enrichment-based scoring."
            />
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
                    <p className="truncate text-sm font-semibold text-slate-900">{p.name}</p>
                    {p.address && <p className="mt-1 text-xs text-slate-500">{p.address}</p>}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {p.phone && (
                        <Badge color="gray">
                          <Phone className="mr-1 inline h-3 w-3" aria-hidden />
                          {p.phone}
                        </Badge>
                      )}
                      {p.website && <Badge color="teal">Website on file</Badge>}
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
