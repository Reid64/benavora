"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Building2,
  CheckCircle,
  CheckCircle2,
  ExternalLink,
  Landmark,
  Rocket,
  Users,
  XCircle,
} from "lucide-react";

import { Badge, Button, Card, EmptyState, LoadingSpinner, Select, Textarea } from "@/components/ui";
import type { BadgeVariant } from "@/components/ui";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { createClient } from "@/lib/supabase/client";
import { formatCurrency, formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";

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

type CompanySizeEstimate = "small" | "medium" | "large" | "enterprise";

interface DonorProspectExtraction {
  has_giving_program: boolean | null;
  has_donation_form: boolean | null;
  donation_form_url: string | null;
  csr_page_url: string | null;
  giving_focus_areas: string[];
  in_kind_history_signals: string[];
  decision_contacts: Array<{
    name: string;
    title: string;
    email: string | null;
    phone: string | null;
  }>;
  service_area: string | null;
  company_size_estimate: CompanySizeEstimate | null;
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
  scored_at: string | null;
  pipeline_stage: DdPipelineStage;
  notes: string | null;
  assigned_to: string | null;
  created_at: string;
  directory: DdDirectoryDetail | null;
}

interface OrgMember {
  id: string;
  full_name: string | null;
  email: string;
}

interface NoteEntry {
  content: string;
  author: string;
  created_at: string;
}

/** `notes` is a single `text` column (migration 067) — the timeline is a
 * JSON-array-of-entries serialized into that column, newest first. A
 * pre-existing plain-text value (or an unparseable one) is shown as a
 * single untimed entry rather than dropped. */
function parseNotes(raw: string | null): NoteEntry[] {
  if (!raw || !raw.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed
        .filter((e): e is NoteEntry => Boolean(e) && typeof (e as NoteEntry).content === "string")
        .map((e) => ({
          content: e.content,
          author: typeof e.author === "string" ? e.author : "",
          created_at: typeof e.created_at === "string" ? e.created_at : "",
        }));
    }
  } catch {
    // fall through to legacy plain-text handling below
  }
  return [{ content: raw, author: "", created_at: "" }];
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

/** Green checkmark / gray X indicator (DONOR_DISCOVERY_ARCHITECTURE.md §4). */
function BoolIcon({ value, label }: { value: boolean | null; label: string }) {
  if (value === true) {
    return (
      <span className="inline-flex items-center gap-1.5 text-success-text">
        <CheckCircle2 className="h-4 w-4" aria-hidden />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-navy-400">
      <XCircle className="h-4 w-4" aria-hidden />
      {label}
    </span>
  );
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

  const [members, setMembers] = useState<OrgMember[]>([]);
  const [assigning, setAssigning] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");
  const [addingNote, setAddingNote] = useState(false);

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
      // so detect a prior "Queue in AutoApply" the same way the handoff route
      // matches funders (giving_portal_url, falling back to an exact name
      // match) rather than re-creating a duplicate funder.
      const formUrl = directory.enrichment?.donation_form_url ?? null;
      let funderId: string | null = null;
      if (formUrl) {
        const { data } = await supabase
          .from("funders")
          .select("id")
          .eq("giving_portal_url", formUrl)
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

  useEffect(() => {
    if (!profile?.organization_id) return;
    const supabase = createClient();
    void supabase
      .from("profiles")
      .select("id, full_name, email")
      .then(({ data }) => setMembers((data as OrgMember[] | null) ?? []));
  }, [profile?.organization_id]);

  const noteEntries = useMemo(() => parseNotes(prospect?.notes ?? null), [prospect]);

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
    if (!prospect?.directory) return;
    const directory = prospect.directory;
    const enrichment = directory.enrichment;

    setQueuing(true);
    setQueueError(null);
    try {
      const res = await fetch("/api/autoapply/queue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "donor_discovery",
          prospect_id: prospect.id,
          form_url: enrichment?.donation_form_url ?? null,
          org_name: directory.legal_name,
        }),
      });
      const resPayload = (await res.json().catch(() => ({}))) as {
        error?: string;
        funder_id?: string;
      };
      if (!res.ok || !resPayload.funder_id) {
        setQueueError(resPayload.error ?? "Could not queue this funder for AutoApply.");
        return;
      }

      setQueuedFunderId(resPayload.funder_id);
      setToast("Added to AutoApply queue.");
      setTimeout(() => setToast(null), 4000);
    } finally {
      setQueuing(false);
    }
  }

  async function handleAssigneeChange(nextAssignee: string) {
    if (!prospect) return;
    setAssigning(true);
    try {
      const res = await fetch(`/api/donor-discovery/prospects/${prospect.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assigned_to: nextAssignee || null }),
      });
      if (res.ok) {
        const payload = (await res.json()) as { prospect: DdProspectData };
        setProspect(payload.prospect);
      }
    } finally {
      setAssigning(false);
    }
  }

  async function handleAddNote() {
    if (!prospect || !noteDraft.trim()) return;
    setAddingNote(true);
    try {
      const entry: NoteEntry = {
        content: noteDraft.trim(),
        author: profile?.email ?? "",
        created_at: new Date().toISOString(),
      };
      const nextNotes = JSON.stringify([entry, ...parseNotes(prospect.notes)]);
      const res = await fetch(`/api/donor-discovery/prospects/${prospect.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes: nextNotes }),
      });
      if (res.ok) {
        const payload = (await res.json()) as { prospect: DdProspectData };
        setProspect(payload.prospect);
        setNoteDraft("");
      }
    } finally {
      setAddingNote(false);
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
  const hasDonationForm = enrichment?.has_donation_form === true;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-primary">
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
            {queuedFunderId ? (
              <Link href={`/funders/${queuedFunderId}`}>
                <Button variant="secondary">
                  <CheckCircle className="h-4 w-4" aria-hidden />
                  Queued — view funder
                </Button>
              </Link>
            ) : hasDonationForm ? (
              editable && (
                <Button onClick={() => void handleQueueInAutoApply()} isLoading={queuing} disabled={queuing}>
                  <Rocket className="h-4 w-4" aria-hidden />
                  Queue in AutoApply
                </Button>
              )
            ) : (
              <Button variant="secondary" disabled>
                No donation form found
              </Button>
            )}
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
            <div className="rounded-lg border border-teal-200 bg-teal-50 p-4">
              <p className="whitespace-pre-wrap text-sm text-navy-700">{prospect.score_rationale}</p>
              <p className="mt-3 text-xs text-navy-500">
                Scored {prospect.scored_at ? formatDate(prospect.scored_at) : "-"}
              </p>
            </div>
          ) : (
            <p className="text-sm text-navy-400">Not yet scored.</p>
          )}
        </Card>

        <Card title="Enrichment">
          {enrichment ? (
            <dl className="divide-y divide-navy-100">
              <DetailRow label="Has giving program">
                <BoolIcon value={enrichment.has_giving_program} label={enrichment.has_giving_program ? "Yes" : "No"} />
              </DetailRow>
              <DetailRow label="Has donation form">
                {enrichment.has_donation_form && enrichment.donation_form_url ? (
                  <a
                    href={enrichment.donation_form_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-teal-600 hover:text-teal-700"
                  >
                    {enrichment.donation_form_url}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                  </a>
                ) : (
                  <BoolBadge value={enrichment.has_donation_form} />
                )}
              </DetailRow>
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
              <DetailRow label="In-kind history signals">
                {enrichment.in_kind_history_signals.length > 0 ? (
                  <ul className="list-disc space-y-1 pl-4">
                    {enrichment.in_kind_history_signals.map((signal, i) => (
                      <li key={i}>{signal}</li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-navy-400">-</span>
                )}
              </DetailRow>
              <DetailRow label="Service area">
                {enrichment.service_area ?? <span className="text-navy-400">-</span>}
              </DetailRow>
              <DetailRow label="Company size estimate">
                {enrichment.company_size_estimate ? (
                  <Badge color="gray">{humanizeEnum(enrichment.company_size_estimate)}</Badge>
                ) : (
                  <span className="text-navy-400">-</span>
                )}
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

        <Card title="Activity timeline" className="lg:col-span-2">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="w-full sm:w-64">
              <Select
                label="Assigned to"
                options={[
                  { value: "", label: "Unassigned" },
                  ...members.map((m) => ({ value: m.id, label: m.full_name ?? m.email })),
                ]}
                value={prospect.assigned_to ?? ""}
                disabled={!editable || assigning}
                onChange={(e) => void handleAssigneeChange(e.target.value)}
              />
            </div>
          </div>

          {editable && (
            <div className="mb-4 space-y-2">
              <Textarea
                label="Add a note"
                placeholder="Log a call, email, or other update on this prospect..."
                value={noteDraft}
                onChange={(e) => setNoteDraft(e.target.value)}
                rows={3}
              />
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => void handleAddNote()}
                  isLoading={addingNote}
                  disabled={addingNote || !noteDraft.trim()}
                >
                  Add note
                </Button>
              </div>
            </div>
          )}

          {noteEntries.length > 0 ? (
            <ul className="space-y-4 border-t border-navy-100 pt-4">
              {noteEntries.map((entry, i) => (
                <li key={i} className="text-sm">
                  <p className="whitespace-pre-wrap text-navy-800">{entry.content}</p>
                  {(entry.author || entry.created_at) && (
                    <p className="mt-1 text-xs text-navy-500">
                      {[entry.author, entry.created_at ? formatRelative(entry.created_at) : null]
                        .filter(Boolean)
                        .join(" — ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="border-t border-navy-100 pt-4 text-sm text-navy-400">No notes yet.</p>
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
