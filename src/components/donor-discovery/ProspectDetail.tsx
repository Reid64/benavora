"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  CheckCircle,
  ExternalLink,
  Landmark,
  Rocket,
  Users,
} from "lucide-react";

import { Badge, Button, Card, EmptyState, LoadingSpinner, Select } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatRelative, humanizeEnum } from "@/lib/utils/formatters";

type DdPipelineStage =
  | "new"
  | "reviewing"
  | "contacted"
  | "applied"
  | "received"
  | "rejected"
  | "archived";

const PIPELINE_STAGES: DdPipelineStage[] = [
  "new",
  "reviewing",
  "contacted",
  "applied",
  "received",
  "rejected",
  "archived",
];

const STAGE_BADGE: Record<DdPipelineStage, BadgeVariant> = {
  new: "neutral",
  reviewing: "info",
  contacted: "info",
  applied: "warning",
  received: "success",
  rejected: "error",
  archived: "neutral",
};

function scoreVariant(score: number | null): BadgeVariant {
  if (score == null) return "neutral";
  if (score >= 70) return "success";
  if (score >= 40) return "warning";
  return "neutral";
}

interface DonorProspectExtraction {
  has_giving_program: boolean | null;
  has_donation_form: boolean | null;
  donation_form_url: string | null;
  csr_page_url: string | null;
  giving_focus_areas: string[];
  decision_contacts: Array<{
    name: string;
    title: string;
    email: string | null;
    phone: string | null;
  }>;
  service_area: string | null;
}

interface DdDirectoryDetail {
  id: string;
  legal_name: string;
  dba_name: string | null;
  naics_codes: string[] | null;
  civic_kind: string | null;
  website: string | null;
  hq_address: string | null;
  phone: string | null;
  enrichment: DonorProspectExtraction | null;
  enriched_at: string | null;
  linked_foundation_id: string | null;
  linkage_confidence: number | null;
}

interface DdProspectData {
  id: string;
  score: number | null;
  score_rationale: string | null;
  pipeline_stage: DdPipelineStage;
  notes: string | null;
  created_at: string;
  directory: DdDirectoryDetail | null;
}

interface LinkedFoundation {
  id: string;
  name: string;
  dba: string | null;
  city: string | null;
  state: string | null;
  website: string | null;
  revenue_amount: number | null;
  asset_amount: number | null;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-500">{label}</dt>
      <dd className="mt-1 text-sm text-navy-800">{children}</dd>
    </div>
  );
}

function BoolBadge({ value }: { value: boolean | null }) {
  if (value === true) return <Badge color="green">Yes</Badge>;
  if (value === false) return <Badge color="gray">No</Badge>;
  return <span className="text-navy-400">Unknown</span>;
}

export type ProspectDetailProps = {
  prospectId: string;
};

/**
 * Donor Discovery prospect detail (DONOR_DISCOVERY_ARCHITECTURE.md §4/§7):
 * enrichment record, score rationale, contacts, linked foundation, stage
 * control, and the AutoApply handoff button.
 */
export function ProspectDetail({ prospectId }: ProspectDetailProps) {
  const { profile } = useProfile();
  const [prospect, setProspect] = useState<DdProspectData | null>(null);
  const [labelByCode, setLabelByCode] = useState<Map<string, string>>(new Map());
  const [linkedFoundation, setLinkedFoundation] = useState<LinkedFoundation | null>(null);
  const [queuedFunderId, setQueuedFunderId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [stageSaving, setStageSaving] = useState(false);
  const [queuing, setQueuing] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const res = await fetch(`/api/donor-discovery/prospects/${prospectId}`, { cache: "no-store" });
    if (!res.ok) {
      setError("This prospect could not be found.");
      setLoading(false);
      return;
    }

    const payload = (await res.json()) as { prospect: DdProspectData };
    const loaded = payload.prospect;
    setProspect(loaded);

    const directory = loaded.directory;
    if (directory) {
      const supabase = createClient();
      const codes = [
        ...(directory.naics_codes ?? []),
        ...(directory.civic_kind ? [directory.civic_kind] : []),
      ];

      const [taxonomyRes, foundationRes] = await Promise.all([
        codes.length > 0
          ? supabase.from("donor_discovery_taxonomy").select("code, label").in("code", codes)
          : Promise.resolve({ data: [] as { code: string; label: string }[] }),
        directory.linked_foundation_id
          ? supabase
              .from("foundation_directory")
              .select("id, name, dba, city, state, website, revenue_amount, asset_amount")
              .eq("id", directory.linked_foundation_id)
              .maybeSingle()
          : Promise.resolve({ data: null as LinkedFoundation | null }),
      ]);

      setLabelByCode(new Map((taxonomyRes.data ?? []).map((r) => [r.code, r.label])));
      setLinkedFoundation((foundationRes.data as LinkedFoundation | null) ?? null);

      // Best-effort: donor_discovery_prospects has no persisted link to funders,
      // so detect a prior "Queue in AutoApply" by matching on website (falling
      // back to an exact name match) rather than re-creating a duplicate funder.
      let funderId: string | null = null;
      if (directory.website) {
        const { data } = await supabase
          .from("funders")
          .select("id")
          .eq("website", directory.website)
          .maybeSingle();
        funderId = data?.id ?? null;
      }
      if (!funderId) {
        const { data } = await supabase
          .from("funders")
          .select("id")
          .eq("name", directory.legal_name)
          .maybeSingle();
        funderId = data?.id ?? null;
      }
      setQueuedFunderId(funderId);
    }

    setLoading(false);
  }, [prospectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const categoryBadges = useMemo(() => {
    const directory = prospect?.directory;
    if (!directory) return [];
    const badges: { key: string; label: string }[] = [];
    for (const code of directory.naics_codes ?? []) {
      badges.push({ key: `naics:${code}`, label: labelByCode.get(code) ?? code });
    }
    if (directory.civic_kind) {
      badges.push({
        key: `civic:${directory.civic_kind}`,
        label: labelByCode.get(directory.civic_kind) ?? humanizeEnum(directory.civic_kind),
      });
    }
    return badges;
  }, [prospect, labelByCode]);

  async function handleStageChange(next: DdPipelineStage) {
    if (!prospect) return;
    setStageSaving(true);
    try {
      const res = await fetch(`/api/donor-discovery/prospects/${prospect.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipeline_stage: next }),
      });
      if (res.ok) {
        const payload = (await res.json()) as { prospect: DdProspectData };
        setProspect(payload.prospect);
      }
    } finally {
      setStageSaving(false);
    }
  }

  async function handleQueueInAutoApply() {
    if (!prospect?.directory || !profile?.organization_id) return;
    const directory = prospect.directory;
    const enrichment = directory.enrichment;

    setQueuing(true);
    setQueueError(null);
    try {
      const supabase = createClient();
      const { data: newFunder, error: funderError } = await supabase
        .from("funders")
        .insert({
          organization_id: profile.organization_id,
          name: directory.legal_name,
          category: "in_kind_donation",
          website: directory.website,
          giving_portal_url: enrichment?.donation_form_url ?? null,
          has_giving_page: true,
          geographic_focus: directory.hq_address,
        })
        .select("id")
        .single();

      if (funderError || !newFunder) {
        setQueueError("Could not create a funder record for this prospect.");
        return;
      }

      const res = await fetch("/api/autoapply/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funder_ids: [newFunder.id] }),
      });
      const resPayload = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setQueueError(resPayload.error ?? "Could not queue this funder for AutoApply.");
        return;
      }

      setQueuedFunderId(newFunder.id);
      setToast(`Queued ${directory.legal_name} for AutoApply.`);
      setTimeout(() => setToast(null), 4000);
    } finally {
      setQueuing(false);
    }
  }

  if (loading) {
    return <LoadingSpinner center label="Loading prospect..." />;
  }

  if (error || !prospect) {
    return (
      <EmptyState
        icon={Building2}
        title="Prospect unavailable"
        description={error ?? "This prospect could not be found."}
      />
    );
  }

  const directory = prospect.directory;
  const enrichment = directory?.enrichment ?? null;
  const editable = canEdit(profile?.role);
  const canQueue = editable && enrichment?.has_donation_form === true;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
              {directory?.legal_name ?? "Unknown company"}
            </h1>
            <span title={prospect.score_rationale ?? undefined}>
              <Badge variant={scoreVariant(prospect.score)}>
                {prospect.score != null ? `Score ${prospect.score}` : "Unscored"}
              </Badge>
            </span>
            <Badge variant={STAGE_BADGE[prospect.pipeline_stage]}>
              {humanizeEnum(prospect.pipeline_stage)}
            </Badge>
          </div>
          {directory?.dba_name && (
            <p className="mt-1 text-sm text-navy-500">dba {directory.dba_name}</p>
          )}
          {categoryBadges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {categoryBadges.map((b) => (
                <Badge key={b.key} color="teal">
                  {b.label}
                </Badge>
              ))}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {editable && (
              <div className="w-44">
                <Select
                  aria-label="Pipeline stage"
                  options={PIPELINE_STAGES.map((s) => ({ value: s, label: humanizeEnum(s) }))}
                  value={prospect.pipeline_stage}
                  disabled={stageSaving}
                  onChange={(e) => void handleStageChange(e.target.value as DdPipelineStage)}
                />
              </div>
            )}
            {canQueue &&
              (queuedFunderId ? (
                <Link href={`/funders/${queuedFunderId}`}>
                  <Button variant="secondary">
                    <CheckCircle className="h-4 w-4" aria-hidden />
                    Queued — view funder
                  </Button>
                </Link>
              ) : (
                <Button onClick={() => void handleQueueInAutoApply()} isLoading={queuing} disabled={queuing}>
                  <Rocket className="h-4 w-4" aria-hidden />
                  Queue in AutoApply
                </Button>
              ))}
          </div>
          {queueError && <p className="text-sm text-red-600">{queueError}</p>}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Company">
          <dl className="divide-y divide-navy-100">
            <DetailRow label="Website">
              {directory?.website ? (
                <a
                  href={directory.website}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-teal-600 hover:text-teal-700"
                >
                  {directory.website}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                </a>
              ) : (
                <span className="text-navy-400">-</span>
              )}
            </DetailRow>
            <DetailRow label="Address">
              {directory?.hq_address ?? <span className="text-navy-400">-</span>}
            </DetailRow>
            <DetailRow label="Phone">
              {directory?.phone ?? <span className="text-navy-400">-</span>}
            </DetailRow>
            <DetailRow label="Last enriched">
              {directory?.enriched_at ? (
                formatRelative(directory.enriched_at)
              ) : (
                <span className="text-navy-400">Not yet enriched</span>
              )}
            </DetailRow>
          </dl>
        </Card>

        <Card title="Score rationale">
          {prospect.score_rationale ? (
            <p className="whitespace-pre-wrap text-sm text-navy-700">{prospect.score_rationale}</p>
          ) : (
            <p className="text-sm text-navy-400">Not yet scored.</p>
          )}
        </Card>

        <Card title="Enrichment">
          {enrichment ? (
            <dl className="divide-y divide-navy-100">
              <DetailRow label="Has giving program">
                <BoolBadge value={enrichment.has_giving_program} />
              </DetailRow>
              <DetailRow label="Has donation form">
                <BoolBadge value={enrichment.has_donation_form} />
              </DetailRow>
              {enrichment.donation_form_url && (
                <DetailRow label="Donation form URL">
                  <a
                    href={enrichment.donation_form_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-teal-600 hover:text-teal-700"
                  >
                    {enrichment.donation_form_url}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </DetailRow>
              )}
              {enrichment.csr_page_url && (
                <DetailRow label="CSR page">
                  <a
                    href={enrichment.csr_page_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-teal-600 hover:text-teal-700"
                  >
                    {enrichment.csr_page_url}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                </DetailRow>
              )}
              <DetailRow label="Giving focus areas">
                {enrichment.giving_focus_areas.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {enrichment.giving_focus_areas.map((area) => (
                      <Badge key={area} color="gray">
                        {area}
                      </Badge>
                    ))}
                  </div>
                ) : (
                  <span className="text-navy-400">-</span>
                )}
              </DetailRow>
              <DetailRow label="Service area">
                {enrichment.service_area ?? <span className="text-navy-400">-</span>}
              </DetailRow>
            </dl>
          ) : (
            <p className="text-sm text-navy-400">No enrichment record yet.</p>
          )}
        </Card>

        <Card title="Contacts">
          {enrichment && enrichment.decision_contacts.length > 0 ? (
            <ul className="space-y-3">
              {enrichment.decision_contacts.map((contact, i) => (
                <li key={i} className="flex items-start gap-3">
                  <Users className="mt-0.5 h-4 w-4 shrink-0 text-navy-400" aria-hidden />
                  <div className="min-w-0">
                    <p className="font-medium text-navy-800">{contact.name}</p>
                    {contact.title && <p className="text-sm text-navy-500">{contact.title}</p>}
                    <div className="mt-0.5 space-y-0.5 text-sm">
                      {contact.email && (
                        <p>
                          <a href={`mailto:${contact.email}`} className="text-teal-600 hover:text-teal-700">
                            {contact.email}
                          </a>
                        </p>
                      )}
                      {contact.phone && <p className="text-navy-600">{contact.phone}</p>}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState
              icon={Users}
              title="No contacts extracted"
              description="Decision-maker contacts found during enrichment will appear here."
            />
          )}
        </Card>

        {linkedFoundation && (
          <Card title="Linked Foundation" className="lg:col-span-2">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="font-medium text-navy-900">{linkedFoundation.name}</p>
                {linkedFoundation.dba && (
                  <p className="text-sm text-navy-500">dba {linkedFoundation.dba}</p>
                )}
                <p className="mt-1 text-sm text-navy-500">
                  {[linkedFoundation.city, linkedFoundation.state].filter(Boolean).join(", ") || "-"}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="text-right text-sm">
                  <p className="text-navy-500">Annual revenue</p>
                  <p className="font-medium text-navy-800">
                    {formatCurrency(linkedFoundation.revenue_amount)}
                  </p>
                </div>
                {directory?.linkage_confidence != null && (
                  <Badge color={directory.linkage_confidence >= 0.75 ? "green" : "yellow"}>
                    <Landmark className="h-3 w-3" aria-hidden />
                    {Math.round(directory.linkage_confidence * 100)}% match
                  </Badge>
                )}
              </div>
            </div>
          </Card>
        )}
      </div>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed right-6 top-6 z-50 flex items-center gap-2 rounded-xl bg-success-text px-5 py-3 text-sm font-medium text-white shadow-xl"
        >
          <CheckCircle className="h-4 w-4 flex-shrink-0" aria-hidden />
          {toast}
        </div>
      )}
    </div>
  );
}
