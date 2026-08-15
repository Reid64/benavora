"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Building2,
  ExternalLink,
  Gauge,
  Sparkles,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { Badge, Button, Card, EmptyState, LoadingSpinner } from "@/components/ui";
import { formatDate, formatRelative } from "@/lib/utils/formatters";

// PS-01..PS-10 per AGENTS_v2.md AG-22 spec — score/rationale/top_factors per
// prospect, plus a "ranking" key computed across the batch (not per-metric).
interface PropensityMetric {
  score: number;
  rationale: string;
  top_factors: string[];
}

interface PropensityRanking {
  rank: number;
  ranked_at: string;
  is_priority_prospect: boolean;
}

type ScoresPayload = Partial<Record<`PS-0${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}` | "PS-10", PropensityMetric>> & {
  ranking?: PropensityRanking;
};

interface CorporateProspectDetail {
  id: string;
  legal_name: string;
  dba_name: string | null;
  ein: string | null;
  duns_number: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  address_street: string | null;
  address_city: string | null;
  address_state: string | null;
  address_zip: string | null;
  naics_code: string | null;
  naics_description: string | null;
  sic_code: string | null;
  industry_category: string | null;
  employee_count_estimate: string | null;
  revenue_estimate: string | null;
  location_count: number | null;
  geographic_footprint: string[] | null;
  ownership_type: string | null;
  is_family_owned: boolean | null;
  is_veteran_owned: boolean | null;
  is_minority_owned: boolean | null;
  is_woman_owned: boolean | null;
  parent_company_id: string | null;
  source_adapters: string[] | null;
  first_seen_at: string | null;
  last_verified_at: string | null;
  enrichment: Record<string, unknown> | null;
  enrichment_version: number | null;
  enrichment_completed_at: string | null;
  scores: ScoresPayload | null;
  scores_computed_at: string | null;
  giving_dna: GivingDnaProfile | Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

interface GivingDnaProfile {
  summary: string;
  outreach_angles: string[];
  data_gaps: string[];
  based_on_fields: string[];
  generated_at: string;
  [key: string]: unknown;
}

function isGivingDnaProfile(value: Record<string, unknown>): value is GivingDnaProfile {
  return typeof value.summary === "string" && Array.isArray(value.outreach_angles);
}

const PS_LABELS: Record<string, string> = {
  "PS-01": "Overall Propensity (weighted aggregate)",
  "PS-02": "Cash Donation Probability",
  "PS-03": "In-Kind Donation Probability",
  "PS-04": "Volunteer Probability",
  "PS-05": "Equipment Donation Probability",
  "PS-06": "Housing Compatibility",
  "PS-07": "Education Compatibility",
  "PS-08": "Food Compatibility",
  "PS-09": "Veteran Compatibility",
  "PS-10": "Disaster Relief Compatibility",
};

const PS_ORDER = [
  "PS-01",
  "PS-02",
  "PS-03",
  "PS-04",
  "PS-05",
  "PS-06",
  "PS-07",
  "PS-08",
  "PS-09",
  "PS-10",
] as const;

function scoreColor(score: number): { backgroundColor: string; color: string } {
  if (score >= 60) return { backgroundColor: "#DCFCE7", color: "#15803D" };
  if (score >= 30) return { backgroundColor: "#FEF3C7", color: "#92400E" };
  return { backgroundColor: "#FEE2E2", color: "#B91C1C" };
}

function OwnershipFlag({ label, value }: { label: string; value: boolean | null }) {
  if (!value) return null;
  return (
    <span
      className="rounded-full px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: "#0077B61A", color: "#0077B6" }}
    >
      {label}
    </span>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-2.5">
      <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-sm text-slate-800">{children}</dd>
    </div>
  );
}

/** Renders whatever keys are actually present in the enrichment jsonb, rather
 * than assuming a fixed field set — different source adapters (Google
 * Places, change-monitor, future EA-0x agents) populate different keys, and
 * a hardcoded field list would silently drop real data. */
function EnrichmentFindings({ enrichment }: { enrichment: Record<string, unknown> }) {
  const entries = Object.entries(enrichment);
  if (entries.length === 0) {
    return <p className="text-sm text-slate-400">No enrichment findings on file.</p>;
  }

  return (
    <dl className="divide-y divide-slate-100">
      {entries.map(([key, value]) => (
        <DetailRow key={key} label={key.replace(/_/g, " ")}>
          <EnrichmentValue value={value} />
        </DetailRow>
      ))}
    </dl>
  );
}

function EnrichmentValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="text-slate-400">-</span>;
  }
  if (typeof value === "boolean") {
    return <Badge color={value ? "green" : "gray"}>{value ? "Yes" : "No"}</Badge>;
  }
  if (typeof value === "string" || typeof value === "number") {
    return <span>{String(value)}</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-400">-</span>;
    return (
      <div className="flex flex-wrap gap-1.5">
        {value.map((v, i) => (
          <Badge key={i} color="teal">
            {typeof v === "string" ? v : JSON.stringify(v)}
          </Badge>
        ))}
      </div>
    );
  }
  // Nested object (e.g. change_monitor_snapshot) — render as a compact
  // key: value list rather than raw JSON, since these do come from real
  // structured agent output, not free text.
  return (
    <div className="space-y-1">
      {Object.entries(value as Record<string, unknown>).map(([k, v]) => (
        <p key={k} className="text-xs text-slate-600">
          <span className="font-medium text-slate-700">{k.replace(/_/g, " ")}:</span>{" "}
          {v === null || v === undefined
            ? "-"
            : typeof v === "object"
              ? JSON.stringify(v)
              : String(v)}
        </p>
      ))}
    </div>
  );
}

export default function CorporateProspectProfilePage({ params }: { params: { id: string } }) {
  const [prospect, setProspect] = useState<CorporateProspectDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await fetch(`/api/intelligence/corporate-prospects/${params.id}`, { cache: "no-store" });
    if (!res.ok) {
      setError(res.status === 404 ? "This prospect could not be found." : "Could not load this prospect.");
      setLoading(false);
      return;
    }
    const payload = (await res.json()) as { prospect: CorporateProspectDetail };
    setProspect(payload.prospect);
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-6">
      <Link
        href="/donor-discovery/outreach"
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to Corporate Outreach
      </Link>

      {loading ? (
        <LoadingSpinner center label="Loading prospect..." />
      ) : error || !prospect ? (
        <EmptyState
          icon={Building2}
          title="Prospect unavailable"
          description={error ?? "This prospect could not be found."}
        />
      ) : (
        <ProspectProfile prospect={prospect} onGivingDnaGenerated={load} />
      )}
    </div>
  );
}

function GivingDnaCard({
  prospectId,
  hasGivingDna,
  profile,
  rawGivingDna,
  onGenerated,
}: {
  prospectId: string;
  hasGivingDna: boolean;
  profile: GivingDnaProfile | null;
  rawGivingDna: Record<string, unknown> | null;
  onGenerated: () => void | Promise<void>;
}) {
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  async function handleGenerate() {
    setGenerating(true);
    setGenError(null);
    try {
      const res = await fetch(`/api/intelligence/corporate-prospects/${prospectId}/giving-dna`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setGenError(body?.error ?? "Could not generate a Giving DNA profile.");
      } else {
        await onGenerated();
      }
    } catch {
      setGenError("Could not reach the server.");
    }
    setGenerating(false);
  }

  const generateButton = (
    <Button type="button" size="sm" onClick={handleGenerate} disabled={generating}>
      <Sparkles className="mr-1 inline h-3.5 w-3.5" aria-hidden />
      {generating ? "Generating..." : hasGivingDna ? "Regenerate Giving DNA" : "Generate Giving DNA"}
    </Button>
  );

  return (
    <div className="space-y-3">
      {genError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {genError}
        </div>
      )}

      {profile ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-slate-800">{profile.summary}</p>

          {profile.outreach_angles.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Outreach angles</p>
              <ul className="mt-1.5 space-y-1.5">
                {profile.outreach_angles.map((angle, i) => (
                  <li key={i} className="flex gap-2 text-sm text-slate-700">
                    <span aria-hidden style={{ color: "#0077B6" }}>
                      •
                    </span>
                    {angle}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {profile.data_gaps.length > 0 && (
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Data gaps</p>
              <ul className="mt-1.5 space-y-1">
                {profile.data_gaps.map((gap, i) => (
                  <li key={i} className="text-xs text-slate-500">
                    {gap}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <p className="border-t border-slate-100 pt-2 text-xs text-slate-400">
            Generated {formatRelative(profile.generated_at)} from {profile.based_on_fields.length} known field
            {profile.based_on_fields.length === 1 ? "" : "s"} on this prospect.
          </p>

          {generateButton}
        </div>
      ) : hasGivingDna && rawGivingDna ? (
        // giving_dna is populated but not in the expected shape (e.g. hand-written test data) — render
        // generically rather than hiding real data behind the typed renderer above.
        <div className="space-y-3">
          <EnrichmentFindings enrichment={rawGivingDna} />
          {generateButton}
        </div>
      ) : (
        <EmptyState
          icon={Sparkles}
          title="Giving DNA not yet built"
          description="A structured giving-behavior profile for this company hasn't been generated yet."
          action={generateButton}
        />
      )}
    </div>
  );
}

function ProspectProfile({
  prospect,
  onGivingDnaGenerated,
}: {
  prospect: CorporateProspectDetail;
  onGivingDnaGenerated: () => void | Promise<void>;
}) {
  const displayName = prospect.dba_name?.trim() || prospect.legal_name;
  const scores = prospect.scores ?? {};
  const scoredMetrics = PS_ORDER.filter((code) => scores[code] != null);
  const hasScores = scoredMetrics.length > 0;
  const ranking = scores.ranking;
  const givingDnaRaw = prospect.giving_dna as Record<string, unknown> | null;
  const hasGivingDna = givingDnaRaw != null && Object.keys(givingDnaRaw).length > 0;
  const givingDnaProfile = givingDnaRaw && isGivingDnaProfile(givingDnaRaw) ? givingDnaRaw : null;
  const hasEnrichment = prospect.enrichment != null && Object.keys(prospect.enrichment).length > 0;

  const addressParts = [
    prospect.address_street,
    [prospect.address_city, prospect.address_state, prospect.address_zip].filter(Boolean).join(", "),
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      <PageHeader
        title={displayName}
        description={
          prospect.industry_category || prospect.naics_description || "Corporate Giving DNA profile"
        }
        actions={
          hasScores && ranking?.is_priority_prospect ? (
            <Badge variant="primary">
              <Sparkles className="mr-1 inline h-3 w-3" aria-hidden />
              Priority prospect · rank #{ranking.rank}
            </Badge>
          ) : undefined
        }
      />

      {prospect.dba_name && (
        <p className="-mt-4 text-sm text-slate-500">Legal name: {prospect.legal_name}</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <OwnershipFlag label="Family owned" value={prospect.is_family_owned} />
        <OwnershipFlag label="Veteran owned" value={prospect.is_veteran_owned} />
        <OwnershipFlag label="Minority owned" value={prospect.is_minority_owned} />
        <OwnershipFlag label="Woman owned" value={prospect.is_woman_owned} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Company">
          <dl className="divide-y divide-slate-100">
            <DetailRow label="Website">
              {prospect.website ? (
                <a
                  href={prospect.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:underline"
                  style={{ color: "#0077B6" }}
                >
                  {prospect.website}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : (
                <span className="text-slate-400">-</span>
              )}
            </DetailRow>
            <DetailRow label="Address">
              {addressParts.length > 0 ? addressParts.join(" · ") : <span className="text-slate-400">-</span>}
            </DetailRow>
            <DetailRow label="Phone">{prospect.phone ?? <span className="text-slate-400">-</span>}</DetailRow>
            <DetailRow label="Email">{prospect.email ?? <span className="text-slate-400">-</span>}</DetailRow>
            <DetailRow label="Industry / NAICS">
              {[prospect.industry_category, prospect.naics_description, prospect.naics_code]
                .filter(Boolean)
                .join(" · ") || <span className="text-slate-400">-</span>}
            </DetailRow>
            <DetailRow label="Employee count / revenue estimate">
              {[prospect.employee_count_estimate, prospect.revenue_estimate].filter(Boolean).join(" · ") || (
                <span className="text-slate-400">-</span>
              )}
            </DetailRow>
            <DetailRow label="Ownership type">
              {prospect.ownership_type ?? <span className="text-slate-400">-</span>}
            </DetailRow>
            <DetailRow label="Locations / geographic footprint">
              {prospect.location_count ?? "-"}
              {prospect.geographic_footprint && prospect.geographic_footprint.length > 0
                ? ` · ${prospect.geographic_footprint.join(", ")}`
                : ""}
            </DetailRow>
            <DetailRow label="EIN / DUNS">
              {[prospect.ein, prospect.duns_number].filter(Boolean).join(" · ") || (
                <span className="text-slate-400">-</span>
              )}
            </DetailRow>
            <DetailRow label="Last verified">
              {prospect.last_verified_at ? (
                formatRelative(prospect.last_verified_at)
              ) : (
                <span className="text-slate-400">Never verified</span>
              )}
            </DetailRow>
          </dl>
        </Card>

        <Card
          title="Propensity Scores (PS-01–PS-10)"
          description={
            hasScores
              ? `Computed ${prospect.scores_computed_at ? formatDate(prospect.scores_computed_at) : "-"}`
              : undefined
          }
        >
          {hasScores ? (
            <div className="space-y-3">
              {scoredMetrics.map((code) => {
                const metric = scores[code]!;
                const badge = scoreColor(metric.score);
                return (
                  <div key={code} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-800">
                        {code} — {PS_LABELS[code] ?? code}
                      </p>
                      <span
                        style={badge}
                        className="shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold"
                      >
                        {metric.score}
                      </span>
                    </div>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600">{metric.rationale}</p>
                    {metric.top_factors.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {metric.top_factors.map((factor, i) => (
                          <span
                            key={i}
                            className="rounded-full px-2 py-0.5 text-xs"
                            style={{ backgroundColor: "#F1F5F9", color: "#64748B" }}
                          >
                            {factor}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              icon={Gauge}
              title="Not yet scored"
              description="This prospect hasn't run through AG-22 propensity scoring yet. Scores appear here once computed."
            />
          )}
        </Card>

        <Card title="Enrichment findings">
          {hasEnrichment ? (
            <EnrichmentFindings enrichment={prospect.enrichment!} />
          ) : (
            <p className="text-sm text-slate-400">No enrichment record yet.</p>
          )}
          {prospect.enrichment_completed_at && (
            <p className="mt-3 border-t border-slate-100 pt-3 text-xs text-slate-500">
              Enrichment last completed {formatRelative(prospect.enrichment_completed_at)}
              {prospect.enrichment_version != null ? ` (v${prospect.enrichment_version})` : ""}
            </p>
          )}
        </Card>

        <Card title="Corporate Giving DNA">
          <GivingDnaCard
            prospectId={prospect.id}
            hasGivingDna={hasGivingDna}
            profile={givingDnaProfile}
            rawGivingDna={givingDnaRaw}
            onGenerated={onGivingDnaGenerated}
          />
        </Card>
      </div>
    </div>
  );
}
