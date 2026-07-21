"use client";

// Knowledge Base Editor — the 10-section profile the AI drafting, probability
// scoring, and Digital Twin (/intelligence/twin) engines all read from. See
// src/lib/knowledge-base/profile.ts's header for the full mapping of each
// section onto real tables (there is no `knowledge_base_profiles` table).
//
// CRITICAL per STANDING_DIRECTIVES.md Directive 4: inline style={{}} with
// hardcoded hex only — no Tailwind color classes, no CSS variables.

import { useCallback, useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import {
  AlertCircle,
  Building2,
  CheckCircle2,
  ExternalLink,
  Landmark,
  Loader2,
  MapPin,
  Plus,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

import { PageHeader } from "@/components/layout/PageHeader";
import { LoadingSpinner } from "@/components/ui";
import { KnowledgeBaseNav } from "@/components/knowledge-base/KnowledgeBaseNav";
import { DocumentUploader } from "@/components/documents/DocumentUploader";
import { createClient } from "@/lib/supabase/client";
import { useProfile, canEdit } from "@/lib/hooks/useProfile";
import {
  SECTION_KEYS,
  SECTION_LABELS,
  scoreColor,
  type ExtendedProfile,
  type Kpi,
  type Milestone,
  type OrganizationProfileFields,
  type Partner,
  type SectionKey,
  type StateRegistration,
} from "@/lib/knowledge-base/profile";
import type { Tables } from "@/types/database";

const CANVAS = "#D6E4F0";
const CARD_BG = "#FFFFFF";
const BORDER = "#C3D3E2";
const NAV_BG = "#1A2B3C";
const NAV_BORDER = "#2A3F55";
const TEXT_PRIMARY = "#0F172A";
const TEXT_MUTED = "#64748B";
const ACCENT = "#0077B6";
const ACCENT_SOFT = "#CAF0F8";
const GREEN = "#10B981";
const AMBER = "#F59E0B";
const RED = "#DC2626";

const COLOR_HEX: Record<"green" | "amber" | "red", string> = {
  green: GREEN,
  amber: AMBER,
  red: RED,
};

const SECTION_ICONS: Record<SectionKey, LucideIcon> = {
  mission_and_vision: Sparkles,
  programs_and_services: Building2,
  financial_profile: Landmark,
  leadership_and_board: Users,
  geographic_service_area: MapPin,
  target_population: Target,
  impact_and_outcomes: TrendingUp,
  organizational_history: Scale,
  partnerships_and_coalitions: Users,
  compliance_and_certifications: ShieldCheck,
};

type OrgRow = OrganizationProfileFields & { id: string };
type BoardMember = Tables<"board_members">;
type Program = Tables<"programs">;

interface LoadState {
  organization: OrgRow;
  extended: ExtendedProfile;
  boardMembers: BoardMember[];
  programs: Program[];
  taxDocumentCount: number;
  sectionScores: Record<SectionKey, number>;
  twinCompletenessScore: number;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

async function fetchProfile(): Promise<LoadState> {
  const res = await fetch("/api/knowledge-base");
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error ?? "Could not load your profile.");
  return {
    organization: payload.organization,
    extended: payload.organization.extended_profile ?? {},
    boardMembers: payload.boardMembers,
    programs: payload.programs,
    taxDocumentCount: payload.taxDocumentCount,
    sectionScores: payload.sectionScores,
    twinCompletenessScore: payload.twinCompletenessScore,
  };
}

async function patchProfile(body: {
  section: SectionKey;
  orgFields?: Partial<Omit<OrganizationProfileFields, "name">>;
  extended?: Partial<ExtendedProfile>;
}): Promise<{ organization: OrgRow & { extended_profile: ExtendedProfile }; sectionScores: Record<SectionKey, number>; twinCompletenessScore: number }> {
  const res = await fetch("/api/knowledge-base", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error ?? "Could not save.");
  return payload;
}

function wordCount(text: string | null | undefined): number {
  if (!text) return 0;
  const trimmed = text.trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// ---------------------------------------------------------------------------
// Shared inline-styled primitives
// ---------------------------------------------------------------------------

function fieldLabelStyle(): CSSProperties {
  return {
    display: "block",
    fontSize: "12px",
    fontWeight: 700,
    color: TEXT_MUTED,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    marginBottom: "6px",
  };
}

function inputStyle(): CSSProperties {
  return {
    width: "100%",
    borderRadius: "8px",
    border: `1px solid ${BORDER}`,
    padding: "10px 12px",
    fontSize: "14px",
    color: TEXT_PRIMARY,
    backgroundColor: "#FFFFFF",
    outline: "none",
  };
}

function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ marginBottom: "16px" }}>
      <label style={fieldLabelStyle()}>{label}</label>
      {children}
      {hint && (
        <p style={{ fontSize: "12px", color: TEXT_MUTED, marginTop: "4px" }}>{hint}</p>
      )}
    </div>
  );
}

function TextInput({
  value,
  onChange,
  onBlur,
  placeholder,
  type = "text",
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  placeholder?: string;
  type?: string;
  disabled?: boolean;
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      style={inputStyle()}
    />
  );
}

function TextAreaInput({
  value,
  onChange,
  onBlur,
  rows = 4,
  placeholder,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  rows?: number;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <textarea
      value={value}
      rows={rows}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      style={{ ...inputStyle(), resize: "vertical", fontFamily: "inherit" }}
    />
  );
}

function TagInput({
  values,
  onChange,
  placeholder,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function commit() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onChange([...values, trimmed]);
    setDraft("");
  }

  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginBottom: values.length ? "8px" : 0 }}>
        {values.map((v, i) => (
          <span
            key={`${v}-${i}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              backgroundColor: ACCENT_SOFT,
              color: "#023E5C",
              borderRadius: "999px",
              padding: "4px 10px",
              fontSize: "12px",
              fontWeight: 600,
            }}
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((_, idx) => idx !== i))}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#023E5C", padding: 0 }}
              aria-label={`Remove ${v}`}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        value={draft}
        placeholder={placeholder ?? "Type and press Enter"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        onBlur={commit}
        style={inputStyle()}
      />
    </div>
  );
}

function SaveIndicator({ status }: { status: SaveStatus }) {
  if (status === "idle") return null;
  if (status === "saving") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: TEXT_MUTED }}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        Saving...
      </span>
    );
  }
  if (status === "error") {
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: RED }}>
        <AlertCircle className="h-3.5 w-3.5" aria-hidden />
        Could not save
      </span>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "12px", color: GREEN }}>
      <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
      Saved
    </span>
  );
}

function SectionCard({
  title,
  description,
  status,
  children,
}: {
  title: string;
  description?: string;
  status: SaveStatus;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        backgroundColor: CARD_BG,
        border: `1px solid ${BORDER}`,
        borderRadius: "14px",
        padding: "24px",
        boxShadow: "0 4px 20px rgba(15,23,42,0.06)",
        marginBottom: "20px",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "12px", marginBottom: "18px" }}>
        <div>
          <h3 style={{ fontSize: "16px", fontWeight: 700, color: TEXT_PRIMARY, margin: 0 }}>{title}</h3>
          {description && (
            <p style={{ fontSize: "13px", color: TEXT_MUTED, margin: "4px 0 0 0" }}>{description}</p>
          )}
        </div>
        <SaveIndicator status={status} />
      </div>
      {children}
    </div>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "6px",
        backgroundColor: ACCENT_SOFT,
        color: "#023E5C",
        border: "none",
        borderRadius: "8px",
        padding: "8px 14px",
        fontSize: "13px",
        fontWeight: 600,
        cursor: "pointer",
      }}
    >
      <Plus className="h-3.5 w-3.5" aria-hidden />
      {label}
    </button>
  );
}

function RemoveButton({ onClick, label }: { onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      style={{
        background: "none",
        border: "none",
        cursor: "pointer",
        color: RED,
        padding: "4px",
        display: "inline-flex",
      }}
    >
      <Trash2 className="h-4 w-4" aria-hidden />
    </button>
  );
}

function DynamicListRow({ children, onRemove }: { children: ReactNode; onRemove: () => void }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: "10px",
        border: `1px solid ${BORDER}`,
        borderRadius: "10px",
        padding: "14px",
        marginBottom: "10px",
        backgroundColor: "#FAFCFE",
      }}
    >
      <div style={{ flex: 1, display: "grid", gap: "10px" }}>{children}</div>
      <RemoveButton onClick={onRemove} label="Remove" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function KnowledgeBaseEditPage() {
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [state, setState] = useState<LoadState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [active, setActive] = useState<SectionKey>("mission_and_vision");
  const [statusBySection, setStatusBySection] = useState<Record<string, SaveStatus>>({});

  const debounceTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await fetchProfile();
      setState(data);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Could not load your profile.");
    }
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const setSectionStatus = useCallback((section: SectionKey, status: SaveStatus) => {
    setStatusBySection((prev) => ({ ...prev, [section]: status }));
  }, []);

  /** Persists a section change: org-column fields and/or extended_profile
   * keys. Recomputes the digital twin score server-side on every save. */
  const save = useCallback(
    async (
      section: SectionKey,
      payload: {
        orgFields?: Partial<Omit<OrganizationProfileFields, "name">>;
        extended?: Partial<ExtendedProfile>;
      },
    ) => {
      setSectionStatus(section, "saving");
      try {
        const result = await patchProfile({ section, ...payload });
        setState((prev) =>
          prev
            ? {
                ...prev,
                organization: result.organization,
                extended: result.organization.extended_profile,
                sectionScores: result.sectionScores,
                twinCompletenessScore: result.twinCompletenessScore,
              }
            : prev,
        );
        setSectionStatus(section, "saved");
      } catch {
        setSectionStatus(section, "error");
      }
    },
    [setSectionStatus],
  );

  /** 500ms-debounced save, keyed per section so unrelated sections don't
   * cancel each other's pending saves. */
  const debouncedSave = useCallback(
    (
      section: SectionKey,
      payload: {
        orgFields?: Partial<Omit<OrganizationProfileFields, "name">>;
        extended?: Partial<ExtendedProfile>;
      },
    ) => {
      const timers = debounceTimers.current;
      if (timers[section]) clearTimeout(timers[section]);
      timers[section] = setTimeout(() => void save(section, payload), 500);
    },
    [save],
  );

  // Reload just board/programs/tax-doc-derived state without a full page
  // loading spinner (used after sub-resource CRUD).
  const refreshSubResources = useCallback(async () => {
    try {
      const data = await fetchProfile();
      setState(data);
    } catch {
      // Non-fatal — the next full load will reconcile.
    }
  }, []);

  const sectionScores = state?.sectionScores;

  if (loading) {
    return (
      <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
        <LoadingSpinner center label="Loading your knowledge base..." />
      </div>
    );
  }

  if (loadError || !state) {
    return (
      <div className="min-h-screen p-6" style={{ backgroundColor: CANVAS }}>
        <div
          role="alert"
          style={{
            borderRadius: "10px",
            border: "1px solid #FECACA",
            backgroundColor: "#FEF2F2",
            color: "#B91C1C",
            padding: "14px 16px",
            fontSize: "14px",
          }}
        >
          {loadError ?? "Could not load your knowledge base."}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: CANVAS }}>
      <div style={{ padding: "24px 24px 0 24px" }}>
        <PageHeader
          title="Knowledge Base Editor"
          description="Every field here feeds AI drafting, probability scoring, and your Digital Twin. Fill it out completely — every save recalculates your Twin's completeness score."
        />
        <div style={{ margin: "16px 0" }}>
          <KnowledgeBaseNav />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
          <Link
            href="/intelligence/twin"
            style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", fontWeight: 600, color: ACCENT, textDecoration: "none" }}
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            View Digital Twin ({state.twinCompletenessScore}% complete)
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </div>

      <div style={{ display: "flex", gap: "24px", padding: "20px 24px 40px 24px", alignItems: "flex-start" }}>
        <nav
          aria-label="Knowledge base sections"
          style={{
            width: "220px",
            flexShrink: 0,
            backgroundColor: NAV_BG,
            borderRadius: "14px",
            padding: "12px",
            position: "sticky",
            top: "20px",
          }}
        >
          {SECTION_KEYS.map((key) => {
            const score = sectionScores?.[key] ?? 0;
            const color = COLOR_HEX[scoreColor(score)];
            const Icon = SECTION_ICONS[key];
            const isActive = active === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => setActive(key)}
                style={{
                  width: "100%",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  textAlign: "left",
                  background: isActive ? "#233B52" : "transparent",
                  border: `1px solid ${isActive ? NAV_BORDER : "transparent"}`,
                  borderRadius: "10px",
                  padding: "10px 12px",
                  marginBottom: "4px",
                  cursor: "pointer",
                }}
              >
                <Icon className="h-4 w-4 shrink-0" style={{ color: "#8BA8C8" }} aria-hidden />
                <span style={{ flex: 1, fontSize: "13px", fontWeight: 600, color: "#FFFFFF" }}>
                  {SECTION_LABELS[key]}
                </span>
                <span
                  style={{
                    fontSize: "11px",
                    fontWeight: 700,
                    color,
                    backgroundColor: `${color}22`,
                    borderRadius: "999px",
                    padding: "2px 8px",
                    minWidth: "36px",
                    textAlign: "center",
                  }}
                >
                  {score}%
                </span>
              </button>
            );
          })}
        </nav>

        <div style={{ flex: 1, minWidth: 0 }}>
          {active === "mission_and_vision" && (
            <MissionSection
              org={state.organization}
              extended={state.extended}
              editable={editable}
              status={statusBySection.mission_and_vision ?? "idle"}
              onSave={(payload) => debouncedSave("mission_and_vision", payload)}
              onSaveNow={(payload) => void save("mission_and_vision", payload)}
            />
          )}
          {active === "programs_and_services" && (
            <ProgramsSection
              organizationId={profile?.organization_id ?? null}
              programs={state.programs}
              editable={editable}
              status={statusBySection.programs_and_services ?? "idle"}
              onChanged={async () => {
                await refreshSubResources();
                void save("programs_and_services", {});
              }}
            />
          )}
          {active === "financial_profile" && (
            <FinancialSection
              org={state.organization}
              extended={state.extended}
              taxDocumentCount={state.taxDocumentCount}
              editable={editable}
              organizationId={profile?.organization_id ?? null}
              uploadedBy={profile?.id ?? null}
              status={statusBySection.financial_profile ?? "idle"}
              onSave={(payload) => debouncedSave("financial_profile", payload)}
              onSaveNow={(payload) => void save("financial_profile", payload)}
              onDocumentUploaded={async () => {
                await refreshSubResources();
                void save("financial_profile", {});
              }}
            />
          )}
          {active === "leadership_and_board" && (
            <LeadershipSection
              organizationId={profile?.organization_id ?? null}
              extended={state.extended}
              boardMembers={state.boardMembers}
              editable={editable}
              status={statusBySection.leadership_and_board ?? "idle"}
              onSaveNow={(payload) => void save("leadership_and_board", payload)}
              onBoardChanged={async () => {
                await refreshSubResources();
                void save("leadership_and_board", {});
              }}
            />
          )}
          {active === "geographic_service_area" && (
            <GeographicSection
              org={state.organization}
              extended={state.extended}
              editable={editable}
              status={statusBySection.geographic_service_area ?? "idle"}
              onSave={(payload) => debouncedSave("geographic_service_area", payload)}
              onSaveNow={(payload) => void save("geographic_service_area", payload)}
            />
          )}
          {active === "target_population" && (
            <TargetPopulationSection
              org={state.organization}
              extended={state.extended}
              editable={editable}
              status={statusBySection.target_population ?? "idle"}
              onSave={(payload) => debouncedSave("target_population", payload)}
              onSaveNow={(payload) => void save("target_population", payload)}
            />
          )}
          {active === "impact_and_outcomes" && (
            <ImpactSection
              extended={state.extended}
              editable={editable}
              status={statusBySection.impact_and_outcomes ?? "idle"}
              onSave={(payload) => debouncedSave("impact_and_outcomes", payload)}
              onSaveNow={(payload) => void save("impact_and_outcomes", payload)}
            />
          )}
          {active === "organizational_history" && (
            <HistorySection
              org={state.organization}
              extended={state.extended}
              editable={editable}
              status={statusBySection.organizational_history ?? "idle"}
              onSave={(payload) => debouncedSave("organizational_history", payload)}
              onSaveNow={(payload) => void save("organizational_history", payload)}
            />
          )}
          {active === "partnerships_and_coalitions" && (
            <PartnershipsSection
              extended={state.extended}
              editable={editable}
              status={statusBySection.partnerships_and_coalitions ?? "idle"}
              onSave={(payload) => debouncedSave("partnerships_and_coalitions", payload)}
              onSaveNow={(payload) => void save("partnerships_and_coalitions", payload)}
            />
          )}
          {active === "compliance_and_certifications" && (
            <ComplianceSection
              org={state.organization}
              extended={state.extended}
              editable={editable}
              status={statusBySection.compliance_and_certifications ?? "idle"}
              onSave={(payload) => debouncedSave("compliance_and_certifications", payload)}
              onSaveNow={(payload) => void save("compliance_and_certifications", payload)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

type SaveFn = (payload: {
  orgFields?: Partial<Omit<OrganizationProfileFields, "name">>;
  extended?: Partial<ExtendedProfile>;
}) => void;

// ---------------------------------------------------------------------------
// Section 1 — Mission & Vision
// ---------------------------------------------------------------------------
function MissionSection({
  org,
  extended,
  editable,
  status,
  onSave,
  onSaveNow,
}: {
  org: OrgRow;
  extended: ExtendedProfile;
  editable: boolean;
  status: SaveStatus;
  onSave: SaveFn;
  onSaveNow: SaveFn;
}) {
  const [mission, setMission] = useState(org.mission_statement ?? "");
  const [vision, setVision] = useState(org.vision_statement ?? "");
  const [founding, setFounding] = useState(org.founding_date ?? "");
  const [values, setValues] = useState<string[]>(extended.core_values ?? []);
  const missionWords = wordCount(mission);

  return (
    <SectionCard
      title="Mission & Vision"
      description="The foundation every AI draft is built from. The more specific, the better your drafts."
      status={status}
    >
      <Field label="Mission statement" hint={`${missionWords} words${missionWords < 50 ? " — expand to at least 50 words for a usable draft, 100+ recommended" : ""}`}>
        <TextAreaInput
          value={mission}
          onChange={setMission}
          onBlur={() => onSave({ orgFields: { mission_statement: mission || null } })}
          rows={5}
          placeholder="Describe your organization's core mission in 100+ words. The more specific you are, the better your AI drafts will be."
          disabled={!editable}
        />
        {missionWords < 50 && (
          <p style={{ color: RED, fontSize: "12px", marginTop: "4px", fontWeight: 600 }}>
            Under 50 words — this is blocking draft generation and fundability scoring.
          </p>
        )}
      </Field>
      <Field label="Vision statement">
        <TextAreaInput
          value={vision}
          onChange={setVision}
          onBlur={() => onSave({ orgFields: { vision_statement: vision || null } })}
          rows={3}
          disabled={!editable}
        />
      </Field>
      <Field label="Core values">
        <TagInput
          values={values}
          onChange={(next) => {
            setValues(next);
            onSaveNow({ extended: { core_values: next } });
          }}
          placeholder="e.g. Integrity — press Enter to add"
        />
      </Field>
      <Field label="Year founded">
        <TextInput
          type="date"
          value={founding}
          onChange={setFounding}
          onBlur={() => onSave({ orgFields: { founding_date: founding || null } })}
          disabled={!editable}
        />
      </Field>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section 2 — Programs & Services (real `programs` table + impact_metrics jsonb)
// ---------------------------------------------------------------------------
function ProgramsSection({
  organizationId,
  programs,
  editable,
  status,
  onChanged,
}: {
  organizationId: string | null;
  programs: Program[];
  editable: boolean;
  status: SaveStatus;
  onChanged: () => Promise<void>;
}) {
  const [rows, setRows] = useState(programs);
  useEffect(() => setRows(programs), [programs]);

  async function updateProgram(id: string, patch: Record<string, unknown>) {
    const supabase = createClient();
    await supabase.from("programs").update(patch).eq("id", id);
    await onChanged();
  }

  async function addProgram() {
    if (!organizationId) return;
    const supabase = createClient();
    await supabase.from("programs").insert({
      organization_id: organizationId,
      name: "New program",
      status: "active",
    });
    await onChanged();
  }

  async function removeProgram(id: string) {
    const supabase = createClient();
    await supabase.from("programs").delete().eq("id", id);
    await onChanged();
  }

  function impactMetrics(program: Program): Record<string, unknown> {
    return (program.impact_metrics as Record<string, unknown> | null) ?? {};
  }

  return (
    <SectionCard
      title="Programs & Services"
      description="Every program funders evaluate. Add at least 3 with full descriptions."
      status={status}
    >
      {rows.map((program) => {
        const metrics = impactMetrics(program);
        return (
          <DynamicListRow key={program.id} onRemove={() => void removeProgram(program.id)}>
            <Field label="Program name">
              <TextInput
                value={program.name}
                onChange={(v) => setRows((prev) => prev.map((p) => (p.id === program.id ? { ...p, name: v } : p)))}
                onBlur={() => void updateProgram(program.id, { name: program.name })}
                disabled={!editable}
              />
            </Field>
            <Field label="Description">
              <TextAreaInput
                value={program.description ?? ""}
                onChange={(v) => setRows((prev) => prev.map((p) => (p.id === program.id ? { ...p, description: v } : p)))}
                onBlur={() => void updateProgram(program.id, { description: program.description || null })}
                rows={3}
                disabled={!editable}
              />
            </Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
              <Field label="Target population">
                <TextInput
                  value={String(metrics.target_population ?? "")}
                  onChange={(v) =>
                    setRows((prev) =>
                      prev.map((p) => (p.id === program.id ? { ...p, impact_metrics: { ...metrics, target_population: v } } : p)),
                    )
                  }
                  onBlur={() => void updateProgram(program.id, { impact_metrics: { ...metrics, target_population: (rows.find((p) => p.id === program.id)?.impact_metrics as Record<string, unknown> | null)?.target_population ?? "" } })}
                  disabled={!editable}
                />
              </Field>
              <Field label="Annual participants served">
                <TextInput
                  type="number"
                  value={program.beneficiaries_served != null ? String(program.beneficiaries_served) : ""}
                  onChange={(v) =>
                    setRows((prev) => prev.map((p) => (p.id === program.id ? { ...p, beneficiaries_served: v ? Number(v) : null } : p)))
                  }
                  onBlur={() => void updateProgram(program.id, { beneficiaries_served: program.beneficiaries_served })}
                  disabled={!editable}
                />
              </Field>
            </div>
            <Field label="Geographic area">
              <TextInput
                value={String(metrics.geographic_area ?? "")}
                onChange={(v) =>
                  setRows((prev) =>
                    prev.map((p) => (p.id === program.id ? { ...p, impact_metrics: { ...metrics, geographic_area: v } } : p)),
                  )
                }
                onBlur={() => {
                  const current = rows.find((p) => p.id === program.id);
                  void updateProgram(program.id, { impact_metrics: current?.impact_metrics ?? {} });
                }}
                disabled={!editable}
              />
            </Field>
            <Field label="Key outcomes">
              <TextAreaInput
                value={String(metrics.key_outcomes ?? "")}
                onChange={(v) =>
                  setRows((prev) =>
                    prev.map((p) => (p.id === program.id ? { ...p, impact_metrics: { ...metrics, key_outcomes: v } } : p)),
                  )
                }
                onBlur={() => {
                  const current = rows.find((p) => p.id === program.id);
                  void updateProgram(program.id, { impact_metrics: current?.impact_metrics ?? {} });
                }}
                rows={2}
                disabled={!editable}
              />
            </Field>
          </DynamicListRow>
        );
      })}
      {editable && <AddButton label="Add program" onClick={() => void addProgram()} />}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section 3 — Financial Profile
// ---------------------------------------------------------------------------
function FinancialSection({
  org,
  extended,
  taxDocumentCount,
  editable,
  organizationId,
  uploadedBy,
  status,
  onSave,
  onSaveNow,
  onDocumentUploaded,
}: {
  org: OrgRow;
  extended: ExtendedProfile;
  taxDocumentCount: number;
  editable: boolean;
  organizationId: string | null;
  uploadedBy: string | null;
  status: SaveStatus;
  onSave: SaveFn;
  onSaveNow: SaveFn;
  onDocumentUploaded: () => Promise<void>;
}) {
  const financial = extended.financial ?? {};
  const [budget, setBudget] = useState(org.annual_budget != null ? String(org.annual_budget) : "");
  const [sources, setSources] = useState(financial.revenue_sources ?? []);
  const [lastAuditedRevenue, setLastAuditedRevenue] = useState(
    financial.last_audited_revenue != null ? String(financial.last_audited_revenue) : "",
  );
  const [lastAuditedYear, setLastAuditedYear] = useState(
    financial.last_audited_year != null ? String(financial.last_audited_year) : "",
  );
  const [endowment, setEndowment] = useState(financial.endowment != null ? String(financial.endowment) : "");
  const [fiscalYearEnd, setFiscalYearEnd] = useState(financial.fiscal_year_end ?? "");

  return (
    <SectionCard
      title="Financial Profile"
      description="Budget, revenue mix, and audit history — used in capacity and sustainability narratives."
      status={status}
    >
      <Field label="Annual operating budget (USD)">
        <TextInput
          type="number"
          value={budget}
          onChange={setBudget}
          onBlur={() => onSave({ orgFields: { annual_budget: budget.trim() ? Number(budget) : null } })}
          disabled={!editable}
        />
      </Field>

      <Field label="Primary revenue sources">
        {sources.map((source, i) => (
          <div key={i} style={{ display: "flex", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
            <div style={{ flex: 2 }}>
              <TextInput
                value={source.source}
                onChange={(v) => setSources((prev) => prev.map((s, idx) => (idx === i ? { ...s, source: v } : s)))}
                onBlur={() => onSaveNow({ extended: { financial: { ...financial, revenue_sources: sources } } })}
                placeholder="e.g. Foundation grants"
                disabled={!editable}
              />
            </div>
            <div style={{ flex: 1 }}>
              <TextInput
                type="number"
                value={source.percentage != null ? String(source.percentage) : ""}
                onChange={(v) =>
                  setSources((prev) => prev.map((s, idx) => (idx === i ? { ...s, percentage: v ? Number(v) : null } : s)))
                }
                onBlur={() => onSaveNow({ extended: { financial: { ...financial, revenue_sources: sources } } })}
                placeholder="%"
                disabled={!editable}
              />
            </div>
            {editable && (
              <RemoveButton
                label="Remove revenue source"
                onClick={() => {
                  const next = sources.filter((_, idx) => idx !== i);
                  setSources(next);
                  onSaveNow({ extended: { financial: { ...financial, revenue_sources: next } } });
                }}
              />
            )}
          </div>
        ))}
        {editable && (
          <AddButton
            label="Add revenue source"
            onClick={() => setSources((prev) => [...prev, { source: "", percentage: null }])}
          />
        )}
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <Field label="Last audited revenue (USD)">
          <TextInput
            type="number"
            value={lastAuditedRevenue}
            onChange={setLastAuditedRevenue}
            onBlur={() =>
              onSaveNow({
                extended: {
                  financial: {
                    ...financial,
                    last_audited_revenue: lastAuditedRevenue.trim() ? Number(lastAuditedRevenue) : null,
                  },
                },
              })
            }
            disabled={!editable}
          />
        </Field>
        <Field label="Last audited fiscal year">
          <TextInput
            type="number"
            value={lastAuditedYear}
            onChange={setLastAuditedYear}
            onBlur={() =>
              onSaveNow({
                extended: { financial: { ...financial, last_audited_year: lastAuditedYear.trim() ? Number(lastAuditedYear) : null } },
              })
            }
            disabled={!editable}
          />
        </Field>
        <Field label="Endowment (if any, USD)">
          <TextInput
            type="number"
            value={endowment}
            onChange={setEndowment}
            onBlur={() =>
              onSaveNow({ extended: { financial: { ...financial, endowment: endowment.trim() ? Number(endowment) : null } } })
            }
            disabled={!editable}
          />
        </Field>
        <Field label="Current fiscal year end">
          <TextInput
            type="date"
            value={fiscalYearEnd}
            onChange={setFiscalYearEnd}
            onBlur={() => onSaveNow({ extended: { financial: { ...financial, fiscal_year_end: fiscalYearEnd || null } } })}
            disabled={!editable}
          />
        </Field>
      </div>

      <Field label={`IRS Form 990 (${taxDocumentCount} on file)`} hint="Uploads go to the real Documents library, category: Tax Documents.">
        {editable && organizationId && uploadedBy ? (
          <DocumentUploader
            organizationId={organizationId}
            uploadedBy={uploadedBy}
            onUploaded={() => void onDocumentUploaded()}
          />
        ) : (
          <p style={{ fontSize: "13px", color: TEXT_MUTED }}>
            {taxDocumentCount} tax document{taxDocumentCount === 1 ? "" : "s"} on file. See{" "}
            <Link href="/documents" style={{ color: ACCENT }}>
              Documents
            </Link>
            .
          </p>
        )}
      </Field>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section 4 — Leadership & Board
// ---------------------------------------------------------------------------
function LeadershipSection({
  organizationId,
  extended,
  boardMembers,
  editable,
  status,
  onSaveNow,
  onBoardChanged,
}: {
  organizationId: string | null;
  extended: ExtendedProfile;
  boardMembers: BoardMember[];
  editable: boolean;
  status: SaveStatus;
  onSaveNow: SaveFn;
  onBoardChanged: () => Promise<void>;
}) {
  const ed = extended.executive_director ?? {};
  const [edName, setEdName] = useState(ed.name ?? "");
  const [edEmail, setEdEmail] = useState(ed.email ?? "");
  const [edPhone, setEdPhone] = useState(ed.phone ?? "");
  const [edBio, setEdBio] = useState(ed.bio ?? "");

  const [rows, setRows] = useState(boardMembers);
  useEffect(() => setRows(boardMembers), [boardMembers]);

  async function updateMember(id: string, patch: Record<string, unknown>) {
    const supabase = createClient();
    await supabase.from("board_members").update(patch).eq("id", id);
    await onBoardChanged();
  }

  async function addMember() {
    if (!organizationId) return;
    const supabase = createClient();
    await supabase.from("board_members").insert({
      organization_id: organizationId,
      name: "New board member",
      is_active: true,
    });
    await onBoardChanged();
  }

  async function removeMember(id: string) {
    const supabase = createClient();
    await supabase.from("board_members").delete().eq("id", id);
    await onBoardChanged();
  }

  return (
    <SectionCard
      title="Leadership & Board"
      description="Executive Director and board roster — establishes credibility with funders."
      status={status}
    >
      <h4 style={{ fontSize: "13px", fontWeight: 700, color: TEXT_PRIMARY, marginBottom: "10px" }}>Executive Director</h4>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <Field label="Name">
          <TextInput
            value={edName}
            onChange={setEdName}
            onBlur={() => onSaveNow({ extended: { executive_director: { ...ed, name: edName } } })}
            disabled={!editable}
          />
        </Field>
        <Field label="Email">
          <TextInput
            type="email"
            value={edEmail}
            onChange={setEdEmail}
            onBlur={() => onSaveNow({ extended: { executive_director: { ...ed, email: edEmail } } })}
            disabled={!editable}
          />
        </Field>
        <Field label="Phone">
          <TextInput
            type="tel"
            value={edPhone}
            onChange={setEdPhone}
            onBlur={() => onSaveNow({ extended: { executive_director: { ...ed, phone: edPhone } } })}
            disabled={!editable}
          />
        </Field>
      </div>
      <Field label="Bio">
        <TextAreaInput
          value={edBio}
          onChange={setEdBio}
          onBlur={() => onSaveNow({ extended: { executive_director: { ...ed, bio: edBio } } })}
          rows={3}
          disabled={!editable}
        />
      </Field>

      <h4 style={{ fontSize: "13px", fontWeight: 700, color: TEXT_PRIMARY, margin: "20px 0 10px 0" }}>
        Board members ({rows.length})
      </h4>
      {rows.map((member) => (
        <DynamicListRow key={member.id} onRemove={() => void removeMember(member.id)}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px" }}>
            <Field label="Name">
              <TextInput
                value={member.name}
                onChange={(v) => setRows((prev) => prev.map((m) => (m.id === member.id ? { ...m, name: v } : m)))}
                onBlur={() => void updateMember(member.id, { name: member.name })}
                disabled={!editable}
              />
            </Field>
            <Field label="Title / profession">
              <TextInput
                value={member.title ?? ""}
                onChange={(v) => setRows((prev) => prev.map((m) => (m.id === member.id ? { ...m, title: v } : m)))}
                onBlur={() => void updateMember(member.id, { title: member.title || null })}
                disabled={!editable}
              />
            </Field>
          </div>
          <Field label="Bio" hint={`${wordCount(member.bio)} words — 50+ recommended`}>
            <TextAreaInput
              value={member.bio ?? ""}
              onChange={(v) => setRows((prev) => prev.map((m) => (m.id === member.id ? { ...m, bio: v } : m)))}
              onBlur={() => void updateMember(member.id, { bio: member.bio || null })}
              rows={2}
              disabled={!editable}
            />
          </Field>
        </DynamicListRow>
      ))}
      {editable && <AddButton label="Add board member" onClick={() => void addMember()} />}
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section 5 — Geographic Service Area
// ---------------------------------------------------------------------------
function GeographicSection({
  org,
  extended,
  editable,
  status,
  onSave,
  onSaveNow,
}: {
  org: OrgRow;
  extended: ExtendedProfile;
  editable: boolean;
  status: SaveStatus;
  onSave: SaveFn;
  onSaveNow: SaveFn;
}) {
  const geo = extended.geographic ?? {};
  const [serviceArea, setServiceArea] = useState(org.service_area ?? "");
  const [radius, setRadius] = useState(geo.radius_miles != null ? String(geo.radius_miles) : "");
  const [counties, setCounties] = useState(geo.counties ?? []);
  const [description, setDescription] = useState(geo.description ?? "");

  return (
    <SectionCard
      title="Geographic Service Area"
      description="Where your organization operates."
      status={status}
    >
      <Field label="Primary service area (city/state)">
        <TextInput
          value={serviceArea}
          onChange={setServiceArea}
          onBlur={() => onSave({ orgFields: { service_area: serviceArea || null } })}
          placeholder="e.g. Rural Texas"
          disabled={!editable}
        />
      </Field>
      <Field label="Service radius (miles)">
        <TextInput
          type="number"
          value={radius}
          onChange={setRadius}
          onBlur={() => onSaveNow({ extended: { geographic: { ...geo, radius_miles: radius.trim() ? Number(radius) : null } } })}
          disabled={!editable}
        />
      </Field>
      <Field label="Counties served">
        <TagInput
          values={counties}
          onChange={(next) => {
            setCounties(next);
            onSaveNow({ extended: { geographic: { ...geo, counties: next } } });
          }}
        />
      </Field>
      <Field label="Service area description">
        <TextAreaInput
          value={description}
          onChange={setDescription}
          onBlur={() => onSaveNow({ extended: { geographic: { ...geo, description: description || null } } })}
          rows={3}
          disabled={!editable}
        />
      </Field>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section 6 — Target Population
// ---------------------------------------------------------------------------
const DEMOGRAPHIC_OPTIONS = [
  "Low-income",
  "Homeless",
  "Veterans",
  "Immigrants",
  "Youth",
  "Seniors",
  "Disabilities",
  "LGBTQ+",
  "Formerly incarcerated",
  "Rural",
];
const LANGUAGE_OPTIONS = ["English", "Spanish", "Mandarin", "Vietnamese", "Arabic", "Tagalog"];

function CheckboxGroup({
  options,
  selected,
  onChange,
  disabled,
}: {
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
      {options.map((option) => {
        const checked = selected.includes(option);
        return (
          <label
            key={option}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              fontSize: "13px",
              color: TEXT_PRIMARY,
              border: `1px solid ${checked ? ACCENT : BORDER}`,
              backgroundColor: checked ? ACCENT_SOFT : "#FFFFFF",
              borderRadius: "8px",
              padding: "6px 10px",
              cursor: disabled ? "default" : "pointer",
            }}
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={disabled}
              onChange={() =>
                onChange(checked ? selected.filter((s) => s !== option) : [...selected, option])
              }
              style={{ margin: 0 }}
            />
            {option}
          </label>
        );
      })}
    </div>
  );
}

function TargetPopulationSection({
  org,
  extended,
  editable,
  status,
  onSave,
  onSaveNow,
}: {
  org: OrgRow;
  extended: ExtendedProfile;
  editable: boolean;
  status: SaveStatus;
  onSave: SaveFn;
  onSaveNow: SaveFn;
}) {
  const detail = extended.target_population_detail ?? {};
  const [targetPopulation, setTargetPopulation] = useState(org.target_population ?? "");
  const [ageMin, setAgeMin] = useState(detail.age_min != null ? String(detail.age_min) : "");
  const [ageMax, setAgeMax] = useState(detail.age_max != null ? String(detail.age_max) : "");
  const [populationSize, setPopulationSize] = useState(
    detail.population_size != null ? String(detail.population_size) : "",
  );

  return (
    <SectionCard title="Target Population" description="Who you serve, in the specific terms funders look for." status={status}>
      <Field label="Primary demographics">
        <TextAreaInput
          value={targetPopulation}
          onChange={setTargetPopulation}
          onBlur={() => onSave({ orgFields: { target_population: targetPopulation || null } })}
          rows={2}
          disabled={!editable}
        />
      </Field>
      <Field label="Populations served">
        <CheckboxGroup
          options={DEMOGRAPHIC_OPTIONS}
          selected={detail.demographics ?? []}
          disabled={!editable}
          onChange={(next) => onSaveNow({ extended: { target_population_detail: { ...detail, demographics: next } } })}
        />
      </Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "16px" }}>
        <Field label="Age range — from">
          <TextInput
            type="number"
            value={ageMin}
            onChange={setAgeMin}
            onBlur={() =>
              onSaveNow({ extended: { target_population_detail: { ...detail, age_min: ageMin.trim() ? Number(ageMin) : null } } })
            }
            disabled={!editable}
          />
        </Field>
        <Field label="Age range — to">
          <TextInput
            type="number"
            value={ageMax}
            onChange={setAgeMax}
            onBlur={() =>
              onSaveNow({ extended: { target_population_detail: { ...detail, age_max: ageMax.trim() ? Number(ageMax) : null } } })
            }
            disabled={!editable}
          />
        </Field>
        <Field label="Population size served annually">
          <TextInput
            type="number"
            value={populationSize}
            onChange={setPopulationSize}
            onBlur={() =>
              onSaveNow({
                extended: { target_population_detail: { ...detail, population_size: populationSize.trim() ? Number(populationSize) : null } },
              })
            }
            disabled={!editable}
          />
        </Field>
      </div>
      <Field label="Language access">
        <CheckboxGroup
          options={LANGUAGE_OPTIONS}
          selected={detail.languages ?? []}
          disabled={!editable}
          onChange={(next) => onSaveNow({ extended: { target_population_detail: { ...detail, languages: next } } })}
        />
      </Field>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section 7 — Impact & Outcomes
// ---------------------------------------------------------------------------
function ImpactSection({
  extended,
  editable,
  status,
  onSave,
  onSaveNow,
}: {
  extended: ExtendedProfile;
  editable: boolean;
  status: SaveStatus;
  onSave: SaveFn;
  onSaveNow: SaveFn;
}) {
  const impact = extended.impact ?? {};
  const [kpis, setKpis] = useState<Kpi[]>(impact.kpis ?? []);
  const [achievements, setAchievements] = useState(impact.achievements ?? "");
  const [awards, setAwards] = useState(impact.awards ?? []);

  function saveKpis(next: Kpi[]) {
    setKpis(next);
    onSaveNow({ extended: { impact: { ...impact, kpis: next } } });
  }

  return (
    <SectionCard
      title="Impact & Outcomes"
      description="Measurable results. Awarded/denied outcomes are tracked automatically as applications resolve."
      status={status}
    >
      <Field label="Key performance indicators">
        {kpis.map((kpi, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr auto", gap: "8px", marginBottom: "8px", alignItems: "center" }}>
            <TextInput
              value={kpi.name}
              placeholder="KPI name"
              onChange={(v) => setKpis((prev) => prev.map((k, idx) => (idx === i ? { ...k, name: v } : k)))}
              onBlur={() => saveKpis(kpis)}
              disabled={!editable}
            />
            <TextInput
              value={kpi.measurement}
              placeholder="Measurement"
              onChange={(v) => setKpis((prev) => prev.map((k, idx) => (idx === i ? { ...k, measurement: v } : k)))}
              onBlur={() => saveKpis(kpis)}
              disabled={!editable}
            />
            <TextInput
              value={kpi.baseline ?? ""}
              placeholder="Baseline"
              onChange={(v) => setKpis((prev) => prev.map((k, idx) => (idx === i ? { ...k, baseline: v } : k)))}
              onBlur={() => saveKpis(kpis)}
              disabled={!editable}
            />
            <TextInput
              value={kpi.current ?? ""}
              placeholder="Current value"
              onChange={(v) => setKpis((prev) => prev.map((k, idx) => (idx === i ? { ...k, current: v } : k)))}
              onBlur={() => saveKpis(kpis)}
              disabled={!editable}
            />
            {editable && <RemoveButton label="Remove KPI" onClick={() => saveKpis(kpis.filter((_, idx) => idx !== i))} />}
          </div>
        ))}
        {editable && (
          <AddButton
            label="Add KPI"
            onClick={() => setKpis((prev) => [...prev, { name: "", measurement: "", baseline: "", current: "" }])}
          />
        )}
      </Field>
      <Field label="Notable achievements">
        <TextAreaInput
          value={achievements}
          onChange={setAchievements}
          onBlur={() => onSave({ extended: { impact: { ...impact, achievements: achievements || null } } })}
          rows={3}
          disabled={!editable}
        />
      </Field>
      <Field label="Awards / recognition">
        <TagInput
          values={awards}
          onChange={(next) => {
            setAwards(next);
            onSaveNow({ extended: { impact: { ...impact, awards: next } } });
          }}
        />
      </Field>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section 8 — Organizational History
// ---------------------------------------------------------------------------
function HistorySection({
  org,
  extended,
  editable,
  status,
  onSave,
  onSaveNow,
}: {
  org: OrgRow;
  extended: ExtendedProfile;
  editable: boolean;
  status: SaveStatus;
  onSave: SaveFn;
  onSaveNow: SaveFn;
}) {
  const history = extended.history ?? {};
  const [foundingStory, setFoundingStory] = useState(org.founder_bio ?? "");
  const [milestones, setMilestones] = useState<Milestone[]>(history.milestones ?? []);
  const [challenges, setChallenges] = useState(history.challenges ?? "");

  function saveMilestones(next: Milestone[]) {
    setMilestones(next);
    onSaveNow({ extended: { history: { ...history, milestones: next } } });
  }

  return (
    <SectionCard title="Organizational History" description="Founding story and milestones — establishes track record." status={status}>
      <Field label="Founding story">
        <TextAreaInput
          value={foundingStory}
          onChange={setFoundingStory}
          onBlur={() => onSave({ orgFields: { founder_bio: foundingStory || null } })}
          rows={4}
          disabled={!editable}
        />
      </Field>
      <Field label="Major milestones">
        {milestones.map((m, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "120px 1fr auto", gap: "8px", marginBottom: "8px" }}>
            <TextInput
              type="number"
              value={m.year != null ? String(m.year) : ""}
              placeholder="Year"
              onChange={(v) => setMilestones((prev) => prev.map((x, idx) => (idx === i ? { ...x, year: v ? Number(v) : null } : x)))}
              onBlur={() => saveMilestones(milestones)}
              disabled={!editable}
            />
            <TextInput
              value={m.milestone}
              placeholder="Milestone"
              onChange={(v) => setMilestones((prev) => prev.map((x, idx) => (idx === i ? { ...x, milestone: v } : x)))}
              onBlur={() => saveMilestones(milestones)}
              disabled={!editable}
            />
            {editable && <RemoveButton label="Remove milestone" onClick={() => saveMilestones(milestones.filter((_, idx) => idx !== i))} />}
          </div>
        ))}
        {editable && (
          <AddButton label="Add milestone" onClick={() => setMilestones((prev) => [...prev, { year: null, milestone: "" }])} />
        )}
      </Field>
      <Field label="Significant challenges overcome">
        <TextAreaInput
          value={challenges}
          onChange={setChallenges}
          onBlur={() => onSaveNow({ extended: { history: { ...history, challenges: challenges || null } } })}
          rows={3}
          disabled={!editable}
        />
      </Field>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section 9 — Partnerships & Coalitions
// ---------------------------------------------------------------------------
function PartnershipsSection({
  extended,
  editable,
  status,
  onSaveNow,
}: {
  extended: ExtendedProfile;
  editable: boolean;
  status: SaveStatus;
  onSave: SaveFn;
  onSaveNow: SaveFn;
}) {
  const partnerships = extended.partnerships ?? {};
  const [partners, setPartners] = useState<Partner[]>(partnerships.partners ?? []);
  const [hasContracts, setHasContracts] = useState(partnerships.government_contracts?.has ?? false);
  const [contractsDescription, setContractsDescription] = useState(partnerships.government_contracts?.description ?? "");
  const [coalitions, setCoalitions] = useState(partnerships.coalitions ?? []);

  function savePartners(next: Partner[]) {
    setPartners(next);
    onSaveNow({ extended: { partnerships: { ...partnerships, partners: next } } });
  }

  function saveContracts(has: boolean, description: string) {
    onSaveNow({ extended: { partnerships: { ...partnerships, government_contracts: { has, description: description || null } } } });
  }

  return (
    <SectionCard title="Partnerships" description="Key partners, government contracts, and coalition memberships." status={status}>
      <Field label="Key partners">
        {partners.map((p, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr auto", gap: "8px", marginBottom: "8px" }}>
            <TextInput
              value={p.name}
              placeholder="Organization name"
              onChange={(v) => setPartners((prev) => prev.map((x, idx) => (idx === i ? { ...x, name: v } : x)))}
              onBlur={() => savePartners(partners)}
              disabled={!editable}
            />
            <TextInput
              value={p.relationship_type ?? ""}
              placeholder="Relationship type"
              onChange={(v) => setPartners((prev) => prev.map((x, idx) => (idx === i ? { ...x, relationship_type: v } : x)))}
              onBlur={() => savePartners(partners)}
              disabled={!editable}
            />
            <TextInput
              value={p.duration ?? ""}
              placeholder="Duration"
              onChange={(v) => setPartners((prev) => prev.map((x, idx) => (idx === i ? { ...x, duration: v } : x)))}
              onBlur={() => savePartners(partners)}
              disabled={!editable}
            />
            {editable && <RemoveButton label="Remove partner" onClick={() => savePartners(partners.filter((_, idx) => idx !== i))} />}
          </div>
        ))}
        {editable && (
          <AddButton label="Add partner" onClick={() => setPartners((prev) => [...prev, { name: "", relationship_type: "", duration: "" }])} />
        )}
      </Field>

      <Field label="Government contracts">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", marginBottom: "8px" }}>
          <input
            type="checkbox"
            checked={hasContracts}
            disabled={!editable}
            onChange={(e) => {
              setHasContracts(e.target.checked);
              saveContracts(e.target.checked, contractsDescription);
            }}
          />
          We hold active government contracts
        </label>
        {hasContracts && (
          <TextAreaInput
            value={contractsDescription}
            onChange={setContractsDescription}
            onBlur={() => saveContracts(hasContracts, contractsDescription)}
            rows={2}
            disabled={!editable}
          />
        )}
      </Field>

      <Field label="Coalition memberships">
        <TagInput
          values={coalitions}
          onChange={(next) => {
            setCoalitions(next);
            onSaveNow({ extended: { partnerships: { ...partnerships, coalitions: next } } });
          }}
        />
      </Field>

      <div
        style={{
          marginTop: "8px",
          padding: "12px 14px",
          borderRadius: "10px",
          backgroundColor: "#F0F7FB",
          border: `1px solid ${BORDER}`,
          fontSize: "13px",
          color: TEXT_MUTED,
        }}
      >
        Partnership <em>narratives</em> your Digital Twin scores are separate free-text entries — manage those on{" "}
        <Link href="/knowledge-base/narratives?category=partnerships" style={{ color: ACCENT, fontWeight: 600 }}>
          Narratives → Partnerships
        </Link>
        .
      </div>
    </SectionCard>
  );
}

// ---------------------------------------------------------------------------
// Section 10 — Compliance & Certifications
// ---------------------------------------------------------------------------
function ComplianceSection({
  org,
  extended,
  editable,
  status,
  onSave,
  onSaveNow,
}: {
  org: OrgRow;
  extended: ExtendedProfile;
  editable: boolean;
  status: SaveStatus;
  onSave: SaveFn;
  onSaveNow: SaveFn;
}) {
  const compliance = extended.compliance ?? {};
  const [taxStatus, setTaxStatus] = useState(org.tax_status ?? "");
  const [registrations, setRegistrations] = useState<StateRegistration[]>(compliance.state_registrations ?? []);
  const [lastAuditDate, setLastAuditDate] = useState(compliance.last_audit_date ?? "");
  const [auditResult, setAuditResult] = useState(compliance.audit_result ?? "");
  const [hasInsurance, setHasInsurance] = useState(compliance.insurance?.has ?? false);
  const [insuranceTypes, setInsuranceTypes] = useState(compliance.insurance?.types ?? []);
  const [backgroundCheckPolicy, setBackgroundCheckPolicy] = useState(compliance.background_check_policy ?? false);

  function saveRegistrations(next: StateRegistration[]) {
    setRegistrations(next);
    onSaveNow({ extended: { compliance: { ...compliance, state_registrations: next } } });
  }

  return (
    <SectionCard title="Compliance & Certifications" description="Tax status, registrations, and audit history." status={status}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <Field label="501(c)(3) / tax-exempt status">
          <TextInput
            value={taxStatus}
            onChange={setTaxStatus}
            onBlur={() => onSave({ orgFields: { tax_status: taxStatus || null } })}
            placeholder="e.g. 501(c)(3), 508(c)(1)(a)"
            disabled={!editable}
          />
        </Field>
        <Field label="EIN">
          <TextInput value={org.ein ?? ""} onChange={() => {}} onBlur={() => {}} disabled />
        </Field>
      </div>

      <Field label="State charity registrations">
        {registrations.map((reg, i) => (
          <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "8px", marginBottom: "8px" }}>
            <TextInput
              value={reg.state}
              placeholder="State"
              onChange={(v) => setRegistrations((prev) => prev.map((r, idx) => (idx === i ? { ...r, state: v } : r)))}
              onBlur={() => saveRegistrations(registrations)}
              disabled={!editable}
            />
            <TextInput
              value={reg.registration_number ?? ""}
              placeholder="Registration number"
              onChange={(v) => setRegistrations((prev) => prev.map((r, idx) => (idx === i ? { ...r, registration_number: v } : r)))}
              onBlur={() => saveRegistrations(registrations)}
              disabled={!editable}
            />
            {editable && (
              <RemoveButton label="Remove registration" onClick={() => saveRegistrations(registrations.filter((_, idx) => idx !== i))} />
            )}
          </div>
        ))}
        {editable && (
          <AddButton label="Add state registration" onClick={() => setRegistrations((prev) => [...prev, { state: "", registration_number: "" }])} />
        )}
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
        <Field label="Last audit date">
          <TextInput
            type="date"
            value={lastAuditDate}
            onChange={setLastAuditDate}
            onBlur={() => onSaveNow({ extended: { compliance: { ...compliance, last_audit_date: lastAuditDate || null } } })}
            disabled={!editable}
          />
        </Field>
        <Field label="Audit result">
          <select
            value={auditResult}
            disabled={!editable}
            onChange={(e) => {
              const value = e.target.value as typeof auditResult;
              setAuditResult(value);
              onSaveNow({ extended: { compliance: { ...compliance, audit_result: value } } });
            }}
            style={inputStyle()}
          >
            <option value="">Not specified</option>
            <option value="clean">Clean</option>
            <option value="qualified">Qualified</option>
            <option value="adverse">Adverse</option>
          </select>
        </Field>
      </div>

      <Field label="Insurance coverage">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px", marginBottom: "8px" }}>
          <input
            type="checkbox"
            checked={hasInsurance}
            disabled={!editable}
            onChange={(e) => {
              setHasInsurance(e.target.checked);
              onSaveNow({ extended: { compliance: { ...compliance, insurance: { has: e.target.checked, types: insuranceTypes } } } });
            }}
          />
          We carry insurance coverage
        </label>
        {hasInsurance && (
          <TagInput
            values={insuranceTypes}
            onChange={(next) => {
              setInsuranceTypes(next);
              onSaveNow({ extended: { compliance: { ...compliance, insurance: { has: true, types: next } } } });
            }}
            placeholder="e.g. General liability"
          />
        )}
      </Field>

      <Field label="Background check policy">
        <label style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
          <input
            type="checkbox"
            checked={backgroundCheckPolicy}
            disabled={!editable}
            onChange={(e) => {
              setBackgroundCheckPolicy(e.target.checked);
              onSaveNow({ extended: { compliance: { ...compliance, background_check_policy: e.target.checked } } });
            }}
          />
          We have a documented background check policy for staff/volunteers
        </label>
      </Field>
    </SectionCard>
  );
}
