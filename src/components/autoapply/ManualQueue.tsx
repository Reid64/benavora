"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Download,
  ExternalLink,
  ShieldAlert,
  UserCheck,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, Card, EmptyState } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import type { Json } from "@/types/database";

// ── Types ──────────────────────────────────────────────────────────────────────

interface ManualQueueRow {
  id: string;
  organization_id: string;
  funder_id: string | null;
  priority: number;
  status: string;
  automation_mode: string;
  created_at: string;
  funders: { name: string; giving_portal_url: string | null } | null;
}

// Optional columns from future risk-engine migration.
interface ExtendedRow extends ManualQueueRow {
  risk_score?: number | null;
  risk_factors?: Json | null;
  request_type?: string | null;
}

// Exported so other review surfaces (e.g. ReviewQueuePage) can render the
// exact same risk badge style rather than inventing a second one — per
// AUTOAPPLY_ARCHITECTURE_V2.md §10C: "reuses ManualQueue.tsx's existing
// RiskFactor badge rendering rather than inventing a second style."
export interface RiskFactor {
  name: string;
  points: number;
  description: string;
}

interface FieldEntry {
  kbField: string;
  formField: string;
  value: string;
}

interface OrgDocEntry {
  id: string;
  document_type: string;
  file_name: string;
  storage_path: string;
  expires_at: string | null;
}

interface OrgMember {
  id: string;
  email: string;
  full_name: string | null;
}

interface OrgProfile {
  name: string;
  ein: string | null;
  mission_statement: string | null;
  vision_statement: string | null;
  service_area: string | null;
  target_population: string | null;
  website: string | null;
  email: string | null;
  phone: string | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
}

interface PrepData {
  portalUrl: string | null;
  fieldEntries: FieldEntry[];
  pitch: string | null;
  requestType: string | null;
  optimizedAmount: number | null;
  documents: OrgDocEntry[];
  riskScore: number | null;
  riskFactors: RiskFactor[];
}

// ── Helpers ────────────────────────────────────────────────────────────────────

export function riskScoreProps(score: number | null | undefined): {
  color: BadgeColor;
  label: string;
} {
  if (score === null || score === undefined) return { color: "gray", label: "Unknown" };
  if (score <= 25) return { color: "green", label: `${score} — Low` };
  if (score <= 50) return { color: "yellow", label: `${score} — Medium` };
  if (score <= 75) return { color: "orange", label: `${score} — High` };
  return { color: "red", label: `${score} — Critical` };
}

function requestTypeColor(type: string | null | undefined): BadgeColor {
  switch (type) {
    case "monetary":    return "teal";
    case "land":        return "orange";
    case "in_kind":     return "blue";
    case "volunteer":   return "green";
    case "service":     return "purple";
    case "sponsorship": return "pink";
    case "facility":    return "yellow";
    case "partnership": return "sky";
    default:            return "gray";
  }
}

const KB_LABELS: Record<string, string> = {
  "organization.name":              "Organization Name",
  "organization.ein":               "Tax ID (EIN)",
  "organization.mission_statement": "Mission Statement",
  "organization.vision_statement":  "Vision Statement",
  "organization.service_area":      "Service Area",
  "organization.target_population": "Target Population",
  "organization.website":           "Website",
  "organization.email":             "Email",
  "organization.phone":             "Phone",
  "organization.address_line1":     "Street Address",
  "organization.city":              "City",
  "organization.state":             "State",
  "organization.zip":               "ZIP Code",
};

function resolveKBValue(field: string, org: OrgProfile | null): string {
  if (!org) return "—";
  const trunc = (s: string | null | undefined): string => {
    if (!s) return "—";
    return s.length > 100 ? s.slice(0, 99) + "…" : s;
  };
  const map: Record<string, string | null | undefined> = {
    "organization.name":              org.name,
    "organization.ein":               org.ein,
    "organization.mission_statement": trunc(org.mission_statement),
    "organization.vision_statement":  trunc(org.vision_statement),
    "organization.service_area":      org.service_area,
    "organization.target_population": org.target_population,
    "organization.website":           org.website,
    "organization.email":             org.email,
    "organization.phone":             org.phone,
    "organization.address_line1":     org.address_line1,
    "organization.city":              org.city,
    "organization.state":             org.state,
    "organization.zip":               org.zip,
  };
  return map[field] ?? "—";
}

export function parseRiskFactors(raw: Json | null | undefined): RiskFactor[] {
  if (!raw || !Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (
      typeof item === "object" &&
      item !== null &&
      !Array.isArray(item)
    ) {
      const r = item as Record<string, unknown>;
      if (typeof r.name !== "string") return [];
      return [{
        name: r.name,
        points: typeof r.points === "number" ? r.points : 0,
        description: typeof r.description === "string" ? r.description : "",
      }];
    }
    return [];
  });
}

const SKIP_REASONS = [
  { value: "not_worth_it",    label: "Not worth pursuing" },
  { value: "portal_broken",   label: "Portal broken / unavailable" },
  { value: "duplicate",       label: "Duplicate submission" },
  { value: "funder_declined", label: "Funder previously declined" },
  { value: "other",           label: "Other" },
] as const;

function formatUSD(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

// ── Props ──────────────────────────────────────────────────────────────────────

export interface ManualQueueProps {
  onCountChange?: (count: number) => void;
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function ManualQueue({ onCountChange }: ManualQueueProps) {
  const { profile } = useProfile();
  const supabase = useMemo(() => createClient(), []);

  const [items, setItems] = useState<ExtendedRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [prepDataMap, setPrepDataMap] = useState<Partial<Record<string, PrepData>>>({});
  const [prepLoadingIds, setPrepLoadingIds] = useState<Set<string>>(new Set());

  // Mark Complete
  const [markCompleteItem, setMarkCompleteItem] = useState<ExtendedRow | null>(null);
  const [confirmNumber, setConfirmNumber] = useState("");
  const [confirmNotes, setConfirmNotes] = useState("");
  const [markCompleteLoading, setMarkCompleteLoading] = useState(false);
  const [markCompleteError, setMarkCompleteError] = useState<string | null>(null);

  // Skip
  const [skipItem, setSkipItem] = useState<ExtendedRow | null>(null);
  const [skipReason, setSkipReason] = useState("not_worth_it");
  const [skipNotes, setSkipNotes] = useState("");
  const [skipLoading, setSkipLoading] = useState(false);

  // Convert to Auto
  const [convertItem, setConvertItem] = useState<ExtendedRow | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [convertLoading, setConvertLoading] = useState(false);

  // Reassign
  const [reassignItem, setReassignItem] = useState<ExtendedRow | null>(null);
  const [orgMembers, setOrgMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("");
  const [reassignLoading, setReassignLoading] = useState(false);

  // Copy feedback
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Data Loading ─────────────────────────────────────────────────────────────

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data, error: err } = await supabase
      .from("submission_queue")
      .select("*, funders(name, giving_portal_url)")
      .in("automation_mode", ["manual", "assisted"])
      .in("status", ["pending", "pending_manual"])
      .order("priority", { ascending: false })
      .order("created_at", { ascending: true });

    if (err) {
      setError("Could not load manual queue.");
    } else {
      const rows = (data ?? []) as unknown as ExtendedRow[];
      setItems(rows);
      setError(null);
      onCountChange?.(rows.length);
    }
    setLoading(false);
  }, [supabase, onCountChange]);

  useEffect(() => {
    void loadItems();

    const channel = supabase
      .channel("manual-queue-live")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "submission_queue" },
        () => void loadItems(),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [loadItems, supabase]);

  // ── Prep Data Lazy Loading ────────────────────────────────────────────────────

  const loadPrepData = useCallback(
    async (item: ExtendedRow) => {
      if (!profile?.organization_id) return;
      if (item.id in prepDataMap) return;
      if (prepLoadingIds.has(item.id)) return;

      setPrepLoadingIds((prev) => new Set(prev).add(item.id));

      const funderId = item.funder_id;

      if (!funderId) {
        setPrepDataMap((prev) => ({
          ...prev,
          [item.id]: {
            portalUrl: item.funders?.giving_portal_url ?? null,
            fieldEntries: [],
            pitch: null,
            requestType: item.request_type ?? null,
            optimizedAmount: null,
            documents: [],
            riskScore: item.risk_score ?? null,
            riskFactors: parseRiskFactors(item.risk_factors),
          },
        }));
        setPrepLoadingIds((prev) => {
          const next = new Set(prev);
          next.delete(item.id);
          return next;
        });
        return;
      }

      const [templateRes, orgRes, docsRes, submissionRes] = await Promise.all([
        supabase
          .from("form_templates")
          .select("field_mapping")
          .eq("organization_id", profile.organization_id)
          .eq("funder_id", funderId)
          .order("last_verified_at", { ascending: false, nullsFirst: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from("organizations")
          .select(
            "name, ein, mission_statement, vision_statement, service_area, target_population, website, email, phone, address_line1, city, state, zip",
          )
          .eq("id", profile.organization_id)
          .single(),
        supabase
          .from("org_documents")
          .select("id, document_type, file_name, storage_path, expires_at")
          .eq("organization_id", profile.organization_id)
          .eq("is_current", true)
          .order("created_at", { ascending: false }),
        supabase
          .from("autoapply_submissions")
          .select("personalized_pitch, optimized_amount, request_type")
          .eq("organization_id", profile.organization_id)
          .eq("funder_id", funderId)
          .not("personalized_pitch", "is", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const org = (orgRes.data as OrgProfile | null) ?? null;
      const rawMapping = templateRes.data?.field_mapping ?? null;
      const documents = (docsRes.data as OrgDocEntry[] | null) ?? [];

      const fieldEntries: FieldEntry[] = [];
      if (
        rawMapping !== null &&
        typeof rawMapping === "object" &&
        !Array.isArray(rawMapping)
      ) {
        for (const [kbField, formField] of Object.entries(
          rawMapping as Record<string, unknown>,
        )) {
          if (typeof formField === "string") {
            fieldEntries.push({
              kbField,
              formField,
              value: resolveKBValue(kbField, org),
            });
          }
        }
      }

      const sub = submissionRes.data as {
        personalized_pitch: string | null;
        optimized_amount: number | null;
        request_type: string | null;
      } | null;

      setPrepDataMap((prev) => ({
        ...prev,
        [item.id]: {
          portalUrl: item.funders?.giving_portal_url ?? null,
          fieldEntries,
          pitch: sub?.personalized_pitch ?? null,
          requestType: sub?.request_type ?? item.request_type ?? null,
          optimizedAmount: sub?.optimized_amount ?? null,
          documents,
          riskScore: item.risk_score ?? null,
          riskFactors: parseRiskFactors(item.risk_factors),
        },
      }));

      setPrepLoadingIds((prev) => {
        const next = new Set(prev);
        next.delete(item.id);
        return next;
      });
    },
    [profile?.organization_id, prepDataMap, prepLoadingIds, supabase],
  );

  function handleRowClick(item: ExtendedRow) {
    if (expandedId === item.id) {
      setExpandedId(null);
    } else {
      setExpandedId(item.id);
      void loadPrepData(item);
    }
  }

  // ── Copy ──────────────────────────────────────────────────────────────────────

  function copyToClipboard(text: string, key: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => setCopiedKey(null), 2000);
    });
  }

  // ── Document Download ─────────────────────────────────────────────────────────

  async function downloadDocument(doc: OrgDocEntry) {
    const { data, error: storageErr } = await supabase.storage
      .from("org-documents")
      .createSignedUrl(doc.storage_path, 60);
    if (storageErr || !data) return;
    const a = document.createElement("a");
    a.href = data.signedUrl;
    a.download = doc.file_name;
    a.click();
  }

  // ── Mark Complete ─────────────────────────────────────────────────────────────

  async function handleMarkComplete() {
    if (!markCompleteItem || !profile?.organization_id) return;
    setMarkCompleteLoading(true);
    setMarkCompleteError(null);

    const { error: subErr } = await supabase.from("autoapply_submissions").insert({
      organization_id: profile.organization_id,
      funder_id: markCompleteItem.funder_id,
      status: "submitted",
      submission_channel: "manual",
      confirmation_number: confirmNumber.trim() || null,
      submitted_at: new Date().toISOString(),
      request_description: confirmNotes.trim() || null,
    });

    if (subErr) {
      setMarkCompleteError("Could not save submission record. Please try again.");
      setMarkCompleteLoading(false);
      return;
    }

    await supabase
      .from("submission_queue")
      .update({
        status: "completed",
        completed_at: new Date().toISOString(),
      })
      .eq("id", markCompleteItem.id);

    setMarkCompleteItem(null);
    setConfirmNumber("");
    setConfirmNotes("");
    setMarkCompleteLoading(false);
    void loadItems();
  }

  // ── Skip ──────────────────────────────────────────────────────────────────────

  async function handleSkip() {
    if (!skipItem) return;
    setSkipLoading(true);

    await supabase
      .from("submission_queue")
      .update({ status: "skipped" })
      .eq("id", skipItem.id);

    setSkipItem(null);
    setSkipReason("not_worth_it");
    setSkipNotes("");
    setSkipLoading(false);
    void loadItems();
  }

  // ── Convert to Auto ───────────────────────────────────────────────────────────

  async function handleConvertToAuto() {
    if (!convertItem || confirmText !== "CONFIRM") return;
    setConvertLoading(true);

    await supabase
      .from("submission_queue")
      .update({ automation_mode: "supervised", status: "pending" })
      .eq("id", convertItem.id);

    setConvertItem(null);
    setConfirmText("");
    setConvertLoading(false);
    void loadItems();
  }

  // ── Reassign ──────────────────────────────────────────────────────────────────

  async function openReassignModal(item: ExtendedRow) {
    setReassignItem(item);
    setSelectedMemberId("");
    setMembersLoading(true);

    if (profile?.organization_id) {
      const { data } = await supabase
        .from("profiles")
        .select("id, email, full_name")
        .eq("organization_id", profile.organization_id)
        .order("full_name");
      setOrgMembers((data ?? []) as OrgMember[]);
    }

    setMembersLoading(false);
  }

  async function handleReassign() {
    if (!reassignItem || !selectedMemberId || !profile?.organization_id) return;
    setReassignLoading(true);

    const member = orgMembers.find((m) => m.id === selectedMemberId);
    const funderName = reassignItem.funders?.name ?? "Unknown funder";

    await supabase.from("automation_notifications").insert({
      organization_id: profile.organization_id,
      event_type: "manual_queue_reassigned",
      title: `Manual Queue: ${funderName}`,
      message: `Submission for ${funderName} has been assigned to ${member?.full_name ?? member?.email ?? "a team member"} for manual handling.`,
      is_read: false,
      sent_via: "in_app",
      related_entity_type: "submission_queue",
      related_entity_id: reassignItem.id,
    });

    setReassignItem(null);
    setSelectedMemberId("");
    setReassignLoading(false);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <>
      <Card
        title="Manual Queue"
        description="Items routed to manual submission based on risk score or portal automation policy"
        noPadding
      >
        <div className="overflow-x-auto">
          {error ? (
            <div className="p-5 text-sm text-red-400">{error}</div>
          ) : loading ? (
            <div className="p-5 text-sm text-navy-400">Loading manual queue…</div>
          ) : items.length === 0 ? (
            <div className="p-5">
              <EmptyState
                icon={ShieldAlert}
                title="No items in manual queue"
                description="High-risk submissions and items from portals with anti-automation policies appear here for human review."
              />
            </div>
          ) : (
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr style={{ backgroundColor: "#2563EB" }}>
                  <th className="w-8 px-4 py-3" />
                  <th className="px-5 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Funder
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Request Type
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Risk Score
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Risk Factors
                  </th>
                  <th className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Added
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100 bg-surface">
                {items.map((item) => {
                  const isExpanded = expandedId === item.id;
                  const prep = prepDataMap[item.id];
                  const isLoadingPrep = prepLoadingIds.has(item.id);
                  const { color: riskColor, label: riskLabel } = riskScoreProps(
                    item.risk_score,
                  );
                  const reqType = item.request_type ?? null;
                  const riskFactors = parseRiskFactors(item.risk_factors);

                  return (
                    <Fragment key={item.id}>
                      <tr
                        className="cursor-pointer hover:bg-navy-50"
                        onClick={() => handleRowClick(item)}
                      >
                        <td className="px-4 py-3 text-navy-400">
                          {isExpanded ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </td>
                        <td className="px-5 py-3 font-medium text-navy-900">
                          {item.funders?.name ?? (
                            <span className="text-navy-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          {reqType ? (
                            <Badge color={requestTypeColor(reqType)}>
                              {reqType.replace(/_/g, " ")}
                            </Badge>
                          ) : (
                            <span className="text-navy-400">—</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge color={riskColor} withDot>
                            {riskLabel}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-xs text-navy-500">
                          {riskFactors.length > 0 ? (
                            <>
                              {riskFactors
                                .slice(0, 2)
                                .map((f) => f.name)
                                .join(", ")}
                              {riskFactors.length > 2 &&
                                ` +${riskFactors.length - 2} more`}
                            </>
                          ) : (
                            <span className="text-navy-400">—</span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-navy-400">
                          {new Date(item.created_at).toLocaleString()}
                        </td>
                      </tr>

                      {isExpanded && (
                        <tr>
                          <td colSpan={6} className="bg-navy-50 px-6 py-5">
                            {isLoadingPrep || prep === undefined ? (
                              <p className="text-sm text-navy-400">
                                Loading submission prep data…
                              </p>
                            ) : (
                              <PrepPanel
                                prep={prep}
                                copiedKey={copiedKey}
                                onCopy={copyToClipboard}
                                onDownload={downloadDocument}
                                onMarkComplete={() => {
                                  setMarkCompleteItem(item);
                                  setConfirmNumber("");
                                  setConfirmNotes("");
                                  setMarkCompleteError(null);
                                }}
                                onSkip={() => {
                                  setSkipItem(item);
                                  setSkipReason("not_worth_it");
                                  setSkipNotes("");
                                }}
                                onConvertToAuto={() => {
                                  setConvertItem(item);
                                  setConfirmText("");
                                }}
                                onReassign={() => void openReassignModal(item)}
                              />
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </Card>

      {/* ── Mark Complete Modal ──────────────────────────────────────────────── */}
      {markCompleteItem !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-navy-900">
                  Mark Submission Complete
                </h2>
                <p className="mt-0.5 text-sm text-navy-500">
                  {markCompleteItem.funders?.name ?? "This funder"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setMarkCompleteItem(null)}
                className="text-navy-400 hover:text-navy-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {markCompleteError !== null && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {markCompleteError}
              </div>
            )}

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="confirm-number"
                  className="mb-1.5 block text-sm font-medium text-navy-700"
                >
                  Confirmation Number{" "}
                  <span className="font-normal text-navy-400">(optional)</span>
                </label>
                <input
                  id="confirm-number"
                  type="text"
                  value={confirmNumber}
                  onChange={(e) => setConfirmNumber(e.target.value)}
                  placeholder="e.g. APP-2024-00123"
                  className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-800 placeholder:text-navy-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
              <div>
                <label
                  htmlFor="confirm-notes"
                  className="mb-1.5 block text-sm font-medium text-navy-700"
                >
                  Notes{" "}
                  <span className="font-normal text-navy-400">(optional)</span>
                </label>
                <textarea
                  id="confirm-notes"
                  value={confirmNotes}
                  onChange={(e) => setConfirmNotes(e.target.value)}
                  rows={3}
                  placeholder="Any notes about this submission…"
                  className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-800 placeholder:text-navy-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setMarkCompleteItem(null)}
                disabled={markCompleteLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleMarkComplete()}
                isLoading={markCompleteLoading}
                disabled={markCompleteLoading}
              >
                <Check className="mr-1.5 h-4 w-4" />
                Mark Complete
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Skip Modal ───────────────────────────────────────────────────────── */}
      {skipItem !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-navy-900">
                  Skip This Submission
                </h2>
                <p className="mt-0.5 text-sm text-navy-500">
                  {skipItem.funders?.name ?? "This funder"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSkipItem(null)}
                className="text-navy-400 hover:text-navy-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label
                  htmlFor="skip-reason"
                  className="mb-1.5 block text-sm font-medium text-navy-700"
                >
                  Reason
                </label>
                <select
                  id="skip-reason"
                  value={skipReason}
                  onChange={(e) => setSkipReason(e.target.value)}
                  className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  {SKIP_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="skip-notes"
                  className="mb-1.5 block text-sm font-medium text-navy-700"
                >
                  Notes{" "}
                  <span className="font-normal text-navy-400">(optional)</span>
                </label>
                <textarea
                  id="skip-notes"
                  value={skipNotes}
                  onChange={(e) => setSkipNotes(e.target.value)}
                  rows={2}
                  placeholder="Additional context…"
                  className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-800 placeholder:text-navy-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
                />
              </div>
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setSkipItem(null)}
                disabled={skipLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleSkip()}
                isLoading={skipLoading}
                disabled={skipLoading}
              >
                Skip Submission
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Convert to Auto Modal ────────────────────────────────────────────── */}
      {convertItem !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-navy-900">
                  Convert to Automated Submission
                </h2>
                <p className="mt-0.5 text-sm text-navy-500">
                  {convertItem.funders?.name ?? "This funder"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setConvertItem(null)}
                className="text-navy-400 hover:text-navy-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              <div className="mb-1 flex items-center gap-1.5">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                <span className="font-medium">Override Risk Assessment</span>
              </div>
              This re-queues the item for supervised automated submission and overrides
              the risk assessment that routed it here. Only proceed if you are confident
              this portal accepts automated submissions.
            </div>

            <div>
              <label
                htmlFor="confirm-text"
                className="mb-1.5 block text-sm font-medium text-navy-700"
              >
                Type{" "}
                <span className="font-mono font-bold text-navy-900">CONFIRM</span>{" "}
                to proceed
              </label>
              <input
                id="confirm-text"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                placeholder="CONFIRM"
                className="w-full rounded-lg border border-navy-200 px-3 py-2 font-mono text-sm text-navy-800 placeholder:text-navy-400 focus:outline-none focus:ring-2 focus:ring-teal-500"
              />
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setConvertItem(null)}
                disabled={convertLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleConvertToAuto()}
                isLoading={convertLoading}
                disabled={convertLoading || confirmText !== "CONFIRM"}
              >
                Convert to Auto
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ── Reassign Modal ───────────────────────────────────────────────────── */}
      {reassignItem !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-2xl">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-base font-semibold text-navy-900">
                  Reassign to Team Member
                </h2>
                <p className="mt-0.5 text-sm text-navy-500">
                  {reassignItem.funders?.name ?? "This funder"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReassignItem(null)}
                className="text-navy-400 hover:text-navy-700"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {membersLoading ? (
              <p className="py-4 text-sm text-navy-400">Loading team members…</p>
            ) : orgMembers.length === 0 ? (
              <p className="py-4 text-sm text-navy-500">No other team members found.</p>
            ) : (
              <div>
                <label
                  htmlFor="reassign-member"
                  className="mb-1.5 block text-sm font-medium text-navy-700"
                >
                  Assign to
                </label>
                <select
                  id="reassign-member"
                  value={selectedMemberId}
                  onChange={(e) => setSelectedMemberId(e.target.value)}
                  className="w-full rounded-lg border border-navy-200 px-3 py-2 text-sm text-navy-800 focus:outline-none focus:ring-2 focus:ring-teal-500"
                >
                  <option value="">Select a team member…</option>
                  {orgMembers.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.full_name ? `${m.full_name} (${m.email})` : m.email}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <Button
                variant="secondary"
                onClick={() => setReassignItem(null)}
                disabled={reassignLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={() => void handleReassign()}
                isLoading={reassignLoading}
                disabled={reassignLoading || !selectedMemberId || membersLoading}
              >
                <UserCheck className="mr-1.5 h-4 w-4" />
                Reassign
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ── Prep Panel (inline expanded content) ─────────────────────────────────────

interface PrepPanelProps {
  prep: PrepData;
  copiedKey: string | null;
  onCopy: (text: string, key: string) => void;
  onDownload: (doc: OrgDocEntry) => Promise<void>;
  onMarkComplete: () => void;
  onSkip: () => void;
  onConvertToAuto: () => void;
  onReassign: () => void;
}

function PrepPanel({
  prep,
  copiedKey,
  onCopy,
  onDownload,
  onMarkComplete,
  onSkip,
  onConvertToAuto,
  onReassign,
}: PrepPanelProps) {
  const { color: riskColor, label: riskLabel } = riskScoreProps(prep.riskScore);

  return (
    <div className="space-y-6" onClick={(e) => e.stopPropagation()}>

      {/* 1. Portal URL */}
      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-navy-500">
          Giving Portal
        </p>
        {prep.portalUrl !== null ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="max-w-sm truncate rounded-lg border border-navy-200 bg-surface px-3 py-2 text-sm text-navy-700">
              {prep.portalUrl}
            </span>
            <a
              href={prep.portalUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <Button size="sm" variant="secondary">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open Portal
              </Button>
            </a>
          </div>
        ) : (
          <p className="text-sm text-navy-400">No portal URL on file for this funder.</p>
        )}
      </div>

      {/* 2. Pre-filled Form Data */}
      {prep.fieldEntries.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-navy-500">
            Pre-Filled Form Data
          </p>
          <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-sm">
            <table className="min-w-full divide-y divide-navy-100 text-sm">
              <thead>
                <tr style={{ backgroundColor: "#2563EB" }}>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Form Field
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-white">
                    Value
                  </th>
                  <th className="w-12 px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-100">
                {prep.fieldEntries.map(({ kbField, formField, value }) => {
                  const copyKey = `field-${kbField}`;
                  return (
                    <tr key={kbField} className="hover:bg-navy-50/50">
                      <td className="px-4 py-2">
                        <span className="font-medium text-navy-700">{formField}</span>
                        <span className="ml-2 text-xs text-navy-400">
                          ({KB_LABELS[kbField] ?? kbField})
                        </span>
                      </td>
                      <td className="max-w-xs truncate px-4 py-2 text-navy-600">
                        {value}
                      </td>
                      <td className="px-4 py-2">
                        <button
                          type="button"
                          onClick={() => onCopy(value, copyKey)}
                          className="text-navy-400 hover:text-teal-500"
                          title="Copy to clipboard"
                          aria-label={`Copy ${formField}`}
                        >
                          {copiedKey === copyKey ? (
                            <Check className="h-3.5 w-3.5 text-green-500" />
                          ) : (
                            <ClipboardCopy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 3. Personalized Pitch */}
      {prep.pitch !== null && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-500">
              Personalized Pitch
            </p>
            <button
              type="button"
              onClick={() => onCopy(prep.pitch!, "pitch")}
              className="flex items-center gap-1 text-xs text-navy-400 hover:text-teal-500"
            >
              {copiedKey === "pitch" ? (
                <>
                  <Check className="h-3.5 w-3.5 text-green-500" />
                  <span className="text-green-500">Copied!</span>
                </>
              ) : (
                <>
                  <ClipboardCopy className="h-3.5 w-3.5" />
                  Copy
                </>
              )}
            </button>
          </div>
          <textarea
            readOnly
            value={prep.pitch}
            rows={5}
            className="w-full rounded-lg border border-navy-200 bg-surface px-4 py-3 text-sm text-navy-700 focus:outline-none"
          />
        </div>
      )}

      {/* 4. Optimized Amount */}
      {prep.optimizedAmount !== null && prep.requestType === "monetary" && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-navy-500">
            Optimized Ask Amount
          </p>
          <div className="flex items-center gap-3">
            <span className="rounded-lg border border-navy-200 bg-surface px-4 py-2 text-lg font-semibold text-navy-900">
              {formatUSD(prep.optimizedAmount)}
            </span>
            <button
              type="button"
              onClick={() => onCopy(String(Math.round(prep.optimizedAmount!)), "amount")}
              className="text-navy-400 hover:text-teal-500"
              title="Copy amount"
              aria-label="Copy amount"
            >
              {copiedKey === "amount" ? (
                <Check className="h-4 w-4 text-green-500" />
              ) : (
                <ClipboardCopy className="h-4 w-4" />
              )}
            </button>
          </div>
        </div>
      )}

      {/* 5. Documents */}
      {prep.documents.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-navy-500">
            Documents to Attach
          </p>
          <div className="space-y-2">
            {prep.documents.map((doc) => (
              <div
                key={doc.id}
                className="flex items-center justify-between rounded-lg border border-navy-200 bg-surface px-4 py-2.5"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-navy-800">
                    {doc.file_name}
                  </p>
                  <p className="text-xs capitalize text-navy-400">
                    {doc.document_type.replace(/_/g, " ")}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void onDownload(doc)}
                >
                  <Download className="mr-1 h-3.5 w-3.5" />
                  Download
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 6. Risk Factors */}
      {prep.riskFactors.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2">
            <p className="text-xs font-medium uppercase tracking-wide text-navy-500">
              Risk Factors
            </p>
            {prep.riskScore !== null && (
              <Badge color={riskColor} withDot>
                {riskLabel}
              </Badge>
            )}
          </div>
          <div className="space-y-2">
            {prep.riskFactors.map((factor, idx) => (
              <div
                key={idx}
                className="flex items-start gap-3 rounded-lg border border-navy-200 bg-surface px-4 py-3"
              >
                <span className="shrink-0 rounded bg-red-100 px-1.5 py-0.5 text-xs font-bold text-red-700">
                  +{factor.points}
                </span>
                <div>
                  <p className="text-sm font-medium text-navy-800">{factor.name}</p>
                  {factor.description && (
                    <p className="text-xs text-navy-500">{factor.description}</p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex flex-wrap gap-2 border-t border-navy-100 pt-4">
        <Button
          size="sm"
          onClick={(e) => {
            e.stopPropagation();
            onMarkComplete();
          }}
        >
          <Check className="mr-1 h-3.5 w-3.5" />
          Mark Complete
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onSkip();
          }}
        >
          Skip
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onConvertToAuto();
          }}
        >
          Convert to Auto
        </Button>
        <Button
          size="sm"
          variant="secondary"
          onClick={(e) => {
            e.stopPropagation();
            onReassign();
          }}
        >
          <UserCheck className="mr-1 h-3.5 w-3.5" />
          Reassign
        </Button>
      </div>
    </div>
  );
}
