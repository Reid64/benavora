"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle,
  Clock,
  DollarSign,
  FileText,
  Globe,
  Tag,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, Modal } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { useProfile } from "@/lib/hooks/useProfile";
import { getOptimalAskAmount } from "@/lib/autoapply/amount-optimizer";
import type { AskAmountResult } from "@/lib/autoapply/amount-optimizer";
import { getTimingScore } from "@/lib/autoapply/timing-optimizer";
import type { TimingScoreResult } from "@/lib/autoapply/timing-optimizer";
import type { Json } from "@/types/database";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FunderDetails {
  id: string;
  name: string;
  category: string | null;
  giving_portal_url: string | null;
  geographic_focus: string | null;
}

interface FormTemplateRow {
  field_mapping: Json | null;
  is_multi_step: boolean;
  requires_login: boolean;
  requires_file_upload: boolean;
  last_verified_at: string | null;
}

interface RequestProfileRow {
  id: string;
  name: string;
  request_type: string;
  needs_description: string;
  pitch_template: string | null;
  min_value: number | null;
  max_value: number | null;
}

interface OrgDocRow {
  id: string;
  document_type: string;
  file_name: string;
  expires_at: string | null;
  is_current: boolean;
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

// Extended queue item including optional request_profile_id (added in later migration).
interface QueueItemRaw {
  id: string;
  funder_id: string | null;
  status: string;
  priority: number;
  automation_mode: string;
  request_profile_id?: string | null;
}

type ControlStatus = "ok" | "warn" | "blocked" | "not_applicable" | "unknown";

interface ControlsState {
  domainThrottle: ControlStatus;
  domainThrottleDetail: string;
  velocity: ControlStatus;
  velocityDetail: string;
  compliance: ControlStatus;
  complianceDetail: string;
}

interface FieldMapping {
  [kbField: string]: string;
}

interface PreviewData {
  funder: FunderDetails;
  fieldMapping: FieldMapping | null;
  formTemplateVerifiedAt: string | null;
  formIsMultiStep: boolean;
  formRequiresLogin: boolean;
  formRequiresUpload: boolean;
  requestProfile: RequestProfileRow | null;
  documents: OrgDocRow[];
  org: OrgProfile | null;
  amount: AskAmountResult | null;
  timing: TimingScoreResult;
  controls: ControlsState;
  warnings: string[];
  pitchPreview: string | null;
  pitchSource: "profile_template" | "needs_description" | "mission_statement" | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const KB_LABELS: Record<string, string> = {
  "organization.name": "Organization Name",
  "organization.ein": "Tax ID (EIN)",
  "organization.mission_statement": "Mission Statement",
  "organization.vision_statement": "Vision Statement",
  "organization.service_area": "Service Area",
  "organization.target_population": "Target Population",
  "organization.website": "Website",
  "organization.email": "Email",
  "organization.phone": "Phone",
  "organization.address_line1": "Street Address",
  "organization.city": "City",
  "organization.state": "State",
  "organization.zip": "ZIP Code",
  "organization.annual_budget": "Annual Budget",
  "organization.total_staff": "Staff Count",
  "organization.total_volunteers": "Volunteer Count",
};

function kbLabel(field: string): string {
  return KB_LABELS[field] ?? field;
}

function resolveKBValue(field: string, org: OrgProfile | null): string {
  if (!org) return "—";
  const truncate = (s: string | null | undefined, max = 100): string => {
    if (!s) return "—";
    return s.length > max ? s.slice(0, max - 1) + "…" : s;
  };
  const map: Record<string, string | null | undefined> = {
    "organization.name": org.name,
    "organization.ein": org.ein,
    "organization.mission_statement": truncate(org.mission_statement),
    "organization.vision_statement": truncate(org.vision_statement),
    "organization.service_area": org.service_area,
    "organization.target_population": org.target_population,
    "organization.website": org.website,
    "organization.email": org.email,
    "organization.phone": org.phone,
    "organization.address_line1": org.address_line1,
    "organization.city": org.city,
    "organization.state": org.state,
    "organization.zip": org.zip,
  };
  return map[field] ?? "—";
}

function parseFieldMapping(raw: Json | null): FieldMapping | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const result: FieldMapping = {};
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === "string") result[k] = v;
  }
  return Object.keys(result).length > 0 ? result : null;
}

function timingColor(score: number): BadgeColor {
  if (score >= 0.8) return "green";
  if (score >= 0.6) return "yellow";
  return "red";
}

function timingLabel(score: number): string {
  if (score >= 0.8) return "Optimal";
  if (score >= 0.6) return "Good";
  return "Off-cycle";
}

function requestTypeColor(type: string): BadgeColor {
  switch (type) {
    case "monetary": return "teal";
    case "land": return "orange";
    case "in_kind": return "blue";
    case "volunteer": return "green";
    case "service": return "purple";
    case "sponsorship": return "pink";
    case "facility": return "yellow";
    case "partnership": return "sky";
    default: return "gray";
  }
}

function confidenceColor(c: string): BadgeColor {
  if (c === "high") return "green";
  if (c === "medium") return "yellow";
  return "gray";
}

function formatUSD(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

function shortMonth(m: number): string {
  return new Date(2000, m - 1).toLocaleString("en-US", { month: "short" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export interface SubmissionPreviewProps {
  queueItemId: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function SubmissionPreview({
  queueItemId,
  onConfirm,
  onCancel,
}: SubmissionPreviewProps) {
  const { profile } = useProfile();
  const [data, setData] = useState<PreviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const fetchPreview = useCallback(async () => {
    if (!profile?.organization_id) return;
    setLoading(true);
    setFetchError(null);

    const supabase = createClient();

    // 1. Queue item — select all to capture request_profile_id if present.
    const { data: qRow, error: qErr } = await supabase
      .from("submission_queue")
      .select("id, funder_id, status, priority, automation_mode")
      .eq("id", queueItemId)
      .single();

    if (qErr || !qRow) {
      setFetchError("Could not load queue item.");
      setLoading(false);
      return;
    }

    // Cast to extended type to access optional request_profile_id column.
    const queueItem = qRow as unknown as QueueItemRaw;
    const funderId = queueItem.funder_id;
    const requestProfileId = queueItem.request_profile_id ?? null;

    if (!funderId) {
      setFetchError("Queue item has no linked funder.");
      setLoading(false);
      return;
    }

    // 2. Parallel fetches: funder, form_template, org, org_documents.
    const [funderRes, templateRes, orgRes, docsRes] = await Promise.all([
      supabase
        .from("funders")
        .select("id, name, category, giving_portal_url, geographic_focus")
        .eq("id", funderId)
        .single(),
      supabase
        .from("form_templates")
        .select(
          "field_mapping, is_multi_step, requires_login, requires_file_upload, last_verified_at",
        )
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
        .select("id, document_type, file_name, expires_at, is_current")
        .eq("organization_id", profile.organization_id)
        .eq("is_current", true)
        .order("created_at", { ascending: false }),
    ]);

    const funder = funderRes.data as FunderDetails | null;
    if (!funder) {
      setFetchError("Funder not found.");
      setLoading(false);
      return;
    }

    const formTemplate = (templateRes.data as FormTemplateRow | null) ?? null;
    const org = (orgRes.data as OrgProfile | null) ?? null;
    const documents = (docsRes.data as OrgDocRow[] | null) ?? [];

    // 3. Request profile — optional, fetch if linked.
    let requestProfile: RequestProfileRow | null = null;
    if (requestProfileId) {
      const { data: rpData } = await supabase
        .from("request_profiles")
        .select(
          "id, name, request_type, needs_description, pitch_template, min_value, max_value",
        )
        .eq("id", requestProfileId)
        .single();
      requestProfile = (rpData as RequestProfileRow | null) ?? null;
    }

    // 4. Amount optimization.
    const amount = await getOptimalAskAmount({
      funderId,
      requestProfile: requestProfile
        ? {
            request_type: requestProfile.request_type,
            min_value: requestProfile.min_value,
            max_value: requestProfile.max_value,
          }
        : null,
      funderCategory: funder.category,
      supabase,
    }).catch(() => null);

    // 5. Timing score.
    const timing = getTimingScore({
      funderType: funder.category ?? "corporate",
      funderCategory: funder.category,
    });

    // 6. Controls — domain throttle.
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const { count: recentCount } = await supabase
      .from("autoapply_submissions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .eq("funder_id", funderId)
      .gte("submitted_at", oneDayAgo);

    const domainThrottle: ControlStatus = (recentCount ?? 0) === 0 ? "ok" : "blocked";
    const domainThrottleDetail =
      (recentCount ?? 0) === 0
        ? `No submissions to ${funder.name} in the last 24 hours.`
        : `Already submitted to ${funder.name} within the last 24 hours — minimum 24 h between submissions.`;

    // Daily velocity.
    const { count: dailyCount } = await supabase
      .from("autoapply_submissions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", profile.organization_id)
      .gte("submitted_at", oneDayAgo);

    let velocity: ControlStatus = "ok";
    let velocityDetail = `${dailyCount ?? 0} submissions today — within limits.`;
    if ((dailyCount ?? 0) >= 100) {
      velocity = "blocked";
      velocityDetail = `${String(dailyCount)} submissions today — daily cap of 100 reached.`;
    } else if ((dailyCount ?? 0) >= 80) {
      velocity = "warn";
      velocityDetail = `${String(dailyCount)} submissions today — approaching daily cap of 100.`;
    }

    // Solicitation compliance — only check when geographic_focus is a 2-letter state code.
    let compliance: ControlStatus = "unknown";
    let complianceDetail = "Funder state not available — compliance check skipped.";
    const geoFocus = funder.geographic_focus?.trim() ?? null;
    const stateCode =
      geoFocus && /^[A-Z]{2}$/i.test(geoFocus) ? geoFocus.toUpperCase() : null;
    if (stateCode) {
      const { count: regCount } = await supabase
        .from("solicitation_registrations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", profile.organization_id)
        .eq("state", stateCode)
        .eq("status", "active");
      compliance = (regCount ?? 0) > 0 ? "ok" : "blocked";
      complianceDetail =
        (regCount ?? 0) > 0
          ? `Active solicitation registration found for ${stateCode}.`
          : `No active registration for ${stateCode}. Review before submitting.`;
    }

    // 7. Pitch preview — request profile takes priority over mission statement.
    let pitchPreview: string | null = null;
    let pitchSource: PreviewData["pitchSource"] = null;
    if (requestProfile?.pitch_template) {
      pitchPreview = requestProfile.pitch_template;
      pitchSource = "profile_template";
    } else if (requestProfile?.needs_description) {
      pitchPreview = requestProfile.needs_description;
      pitchSource = "needs_description";
    } else if (org?.mission_statement) {
      const ms = org.mission_statement;
      pitchPreview = ms.length > 400 ? ms.slice(0, 397) + "…" : ms;
      pitchSource = "mission_statement";
    }

    // 8. Warnings.
    const warnings: string[] = [];
    if (!formTemplate) {
      warnings.push(
        "No form template found — run 'Analyze Form' on this funder's portal before submitting.",
      );
    }
    if (!org?.ein) {
      warnings.push("EIN (Tax ID) is missing from the organization profile.");
    }
    if (!org?.mission_statement) {
      warnings.push("Mission statement is missing — AI pitch generation will be limited.");
    }
    if (formTemplate?.requires_file_upload && documents.length === 0) {
      warnings.push(
        "This portal requires file uploads but the document vault is empty.",
      );
    }
    if (formTemplate?.requires_login) {
      warnings.push(
        "This portal requires a login — verify credentials are saved in the credential vault.",
      );
    }
    if (domainThrottle === "blocked") {
      warnings.push("Already submitted to this funder within the last 24 hours.");
    }
    if (velocity === "blocked") {
      warnings.push("Daily submission cap reached — this item will be held.");
    }
    if (compliance === "blocked") {
      warnings.push(complianceDetail);
    }
    if (timing.score < 0.6) {
      warnings.push(`Off-cycle timing: ${timing.explanation}`);
    }

    setData({
      funder,
      fieldMapping: parseFieldMapping(formTemplate?.field_mapping ?? null),
      formTemplateVerifiedAt: formTemplate?.last_verified_at ?? null,
      formIsMultiStep: formTemplate?.is_multi_step ?? false,
      formRequiresLogin: formTemplate?.requires_login ?? false,
      formRequiresUpload: formTemplate?.requires_file_upload ?? false,
      requestProfile,
      documents,
      org,
      amount,
      timing,
      controls: {
        domainThrottle,
        domainThrottleDetail,
        velocity,
        velocityDetail,
        compliance,
        complianceDetail,
      },
      warnings,
      pitchPreview,
      pitchSource,
    });
    setLoading(false);
  }, [queueItemId, profile?.organization_id]);

  useEffect(() => {
    void fetchPreview();
  }, [fetchPreview]);

  function handleConfirm() {
    setConfirming(true);
    onConfirm();
    setConfirming(false);
  }

  const funderName = data?.funder.name ?? "…";

  return (
    <Modal
      isOpen
      onClose={onCancel}
      title={`Submission Preview — ${funderName}`}
      description={data?.funder.giving_portal_url ?? undefined}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel} disabled={confirming}>
            Cancel
          </Button>
          {data?.requestProfile && (
            <Button
              variant="secondary"
              disabled={confirming}
              onClick={() => {
                const pid = data.requestProfile?.id;
                if (pid) window.open(`/autoapply/profiles?edit=${pid}`, "_blank");
              }}
            >
              Edit Profile
            </Button>
          )}
          <Button
            onClick={handleConfirm}
            isLoading={confirming}
            disabled={confirming || loading}
          >
            Confirm & Submit
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="flex items-center justify-center py-16 text-sm text-navy-400">
          Loading preview…
        </div>
      ) : fetchError ? (
        <div className="rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-3 text-sm text-red-300">
          {fetchError}
        </div>
      ) : data ? (
        <div className="space-y-6">
          {/* ── Warnings ── */}
          {data.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-700/50 bg-amber-900/20 px-4 py-3">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
                <span className="text-sm font-semibold text-amber-300">
                  {data.warnings.length} Warning
                  {data.warnings.length !== 1 ? "s" : ""}
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {data.warnings.map((w, i) => (
                  <li key={i} className="text-xs text-amber-200/80">
                    • {w}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* ── Request Profile ── */}
          <PreviewSection icon={<Tag className="h-4 w-4" />} title="Request Profile">
            {data.requestProfile ? (
              <div className="flex flex-wrap items-start gap-3">
                <Badge color={requestTypeColor(data.requestProfile.request_type)}>
                  {data.requestProfile.request_type.replace(/_/g, " ")}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-navy-900">
                    {data.requestProfile.name}
                  </p>
                  <p className="mt-0.5 text-xs text-navy-500">
                    {data.requestProfile.needs_description}
                  </p>
                  {(data.requestProfile.min_value !== null ||
                    data.requestProfile.max_value !== null) && (
                    <p className="mt-0.5 text-xs text-navy-400">
                      Value range:{" "}
                      {data.requestProfile.min_value !== null
                        ? formatUSD(data.requestProfile.min_value)
                        : "no min"}{" "}
                      –{" "}
                      {data.requestProfile.max_value !== null
                        ? formatUSD(data.requestProfile.max_value)
                        : "no max"}
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-sm text-navy-400">
                No request profile linked — will use default monetary request with org mission
                statement.
              </p>
            )}
          </PreviewSection>

          {/* ── Amount ── */}
          {data.amount ? (
            <PreviewSection
              icon={<DollarSign className="h-4 w-4" />}
              title="Optimized Ask Amount"
            >
              <div className="flex flex-wrap items-baseline gap-3">
                <span className="text-xl font-semibold text-navy-900">
                  {formatUSD(data.amount.recommended)}
                </span>
                <span className="text-sm text-navy-500">
                  range {formatUSD(data.amount.min)} – {formatUSD(data.amount.max)}
                </span>
                <Badge color={confidenceColor(data.amount.confidence)}>
                  {data.amount.confidence} confidence
                </Badge>
                <span className="text-xs text-navy-400">
                  Source: {data.amount.source.replace(/_/g, " ")}
                </span>
              </div>
            </PreviewSection>
          ) : null}

          {/* ── Pitch Preview ── */}
          {data.pitchPreview && (
            <PreviewSection
              icon={<FileText className="h-4 w-4" />}
              title="Pitch Preview"
            >
              <div className="rounded-md border border-navy-100 bg-navy-50 px-4 py-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-navy-700">
                  {data.pitchPreview}
                </p>
              </div>
              <p className="mt-1.5 text-xs text-navy-400">
                {data.pitchSource === "profile_template"
                  ? "From request profile template — will be personalized for " +
                    data.funder.name +
                    " before submission."
                  : data.pitchSource === "needs_description"
                    ? "From request profile needs description."
                    : "From organization mission statement — will be personalized before submission."}
              </p>
            </PreviewSection>
          )}

          {/* ── Form Fields ── */}
          <PreviewSection
            icon={<Globe className="h-4 w-4" />}
            title="Form Field Mapping"
          >
            {(() => {
              const entries = data.fieldMapping
                ? Object.entries(data.fieldMapping)
                : [];
              if (entries.length > 0) {
                return (
                  <>
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-navy-400">
                      {data.formTemplateVerifiedAt && (
                        <span>
                          Template verified{" "}
                          {new Date(data.formTemplateVerifiedAt).toLocaleDateString()}
                        </span>
                      )}
                      {data.formIsMultiStep && (
                        <Badge color="blue">Multi-step form</Badge>
                      )}
                      {data.formRequiresLogin && (
                        <Badge color="yellow">Login required</Badge>
                      )}
                    </div>
                    <div className="overflow-hidden rounded-lg border border-navy-100">
                      <table className="min-w-full divide-y divide-navy-100 text-sm">
                        <thead>
                          <tr className="bg-navy-50">
                            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                              Form Field
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                              KB Source
                            </th>
                            <th className="px-4 py-2 text-left text-xs font-medium uppercase tracking-wide text-navy-500">
                              Value
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-navy-100 bg-white">
                          {entries.map(([kbField, formField]) => {
                            const value = resolveKBValue(kbField, data.org);
                            const missing = value === "—";
                            return (
                              <tr key={kbField} className="hover:bg-navy-50">
                                <td className="px-4 py-2 font-medium text-navy-900">
                                  {formField}
                                </td>
                                <td className="px-4 py-2 text-navy-500">
                                  {kbLabel(kbField)}
                                </td>
                                <td
                                  className={`max-w-xs truncate px-4 py-2 font-mono text-xs ${
                                    missing ? "text-red-400" : "text-navy-600"
                                  }`}
                                >
                                  {value}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                );
              }
              if (data.formTemplateVerifiedAt !== null) {
                return (
                  <p className="text-sm text-navy-400">
                    Form template exists but field mapping is empty — re-analyze the portal to map
                    fields.
                  </p>
                );
              }
              return (
                <div className="rounded-lg border border-navy-100 bg-navy-50 px-4 py-3 text-sm text-navy-500">
                  No form template found. The FormAnalyzer will detect and map fields
                  automatically on first submission.
                </div>
              );
            })()}
          </PreviewSection>

          {/* ── Documents ── */}
          <PreviewSection
            icon={<FileText className="h-4 w-4" />}
            title="Documents"
          >
            {data.documents.length > 0 ? (
              <div className="space-y-1.5">
                {data.documents.slice(0, 12).map((doc) => {
                  const expired =
                    doc.expires_at !== null && new Date(doc.expires_at) < new Date();
                  return (
                    <div
                      key={doc.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-navy-100 bg-navy-50 px-3 py-2 text-sm"
                    >
                      <span
                        className={`font-medium ${expired ? "text-red-400" : "text-navy-900"}`}
                      >
                        {doc.file_name}
                      </span>
                      <div className="flex shrink-0 items-center gap-2">
                        <Badge color="gray">
                          {doc.document_type.replace(/_/g, " ")}
                        </Badge>
                        {expired && <Badge color="red">Expired</Badge>}
                      </div>
                    </div>
                  );
                })}
                {data.documents.length > 12 && (
                  <p className="text-xs text-navy-400">
                    +{data.documents.length - 12} more documents in the vault
                  </p>
                )}
                {data.formRequiresUpload && (
                  <p className="mt-1.5 text-xs font-medium text-teal-400">
                    ✓ This portal accepts file uploads — matching documents will be attached.
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-navy-400">
                No documents in the vault.
                {data.formRequiresUpload
                  ? " This portal requires uploads — add documents before submitting."
                  : ""}
              </p>
            )}
          </PreviewSection>

          {/* ── Timing ── */}
          <PreviewSection
            icon={<Clock className="h-4 w-4" />}
            title="Submission Timing"
          >
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xl font-semibold text-navy-900">
                {Math.round(data.timing.score * 100)}%
              </span>
              <Badge color={timingColor(data.timing.score)}>
                {timingLabel(data.timing.score)}
              </Badge>
              <span className="text-sm text-navy-600">{data.timing.explanation}</span>
            </div>
            {data.timing.optimalMonths.length > 0 && (
              <p className="mt-1.5 text-xs text-navy-400">
                Optimal months:{" "}
                {data.timing.optimalMonths.map(shortMonth).join(", ")}
              </p>
            )}
          </PreviewSection>

          {/* ── Controls ── */}
          <PreviewSection title="Controls & Safety Checks">
            <div className="space-y-2">
              <ControlRow
                label="Domain Throttle"
                status={data.controls.domainThrottle}
                detail={data.controls.domainThrottleDetail}
              />
              <ControlRow
                label="Daily Velocity"
                status={data.controls.velocity}
                detail={data.controls.velocityDetail}
              />
              <ControlRow
                label="Cross-Client Collision"
                status="not_applicable"
                detail="In-house operation — no cross-tenant collision risk."
              />
              <ControlRow
                label="Solicitation Compliance"
                status={data.controls.compliance}
                detail={data.controls.complianceDetail}
              />
            </div>
          </PreviewSection>
        </div>
      ) : null}
    </Modal>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PreviewSection({
  icon,
  title,
  children,
}: {
  icon?: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        {icon && (
          <span className="text-navy-400" aria-hidden>
            {icon}
          </span>
        )}
        <h3 className="text-xs font-semibold uppercase tracking-wide text-navy-500">
          {title}
        </h3>
      </div>
      {children}
    </div>
  );
}

function ControlRow({
  label,
  status,
  detail,
}: {
  label: string;
  status: ControlStatus;
  detail: string;
}) {
  const iconEl =
    status === "ok" || status === "not_applicable" ? (
      <CheckCircle className="h-4 w-4 shrink-0 text-green-400" aria-hidden />
    ) : status === "warn" ? (
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-400" aria-hidden />
    ) : status === "blocked" ? (
      <XCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden />
    ) : (
      <Clock className="h-4 w-4 shrink-0 text-navy-400" aria-hidden />
    );

  return (
    <div className="flex items-start gap-3 rounded-md border border-navy-100 px-3 py-2 text-sm">
      {iconEl}
      <div className="min-w-0 flex-1">
        <span className="font-medium text-navy-900">{label}</span>
        <span className="ml-2 text-xs text-navy-500">{detail}</span>
      </div>
    </div>
  );
}
