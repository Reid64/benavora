"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileSearch,
  FlaskConical,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  SkipForward,
  X,
} from "lucide-react";

import { Badge } from "@/components/ui/Badge";
import type { BadgeColor } from "@/components/ui/Badge";
import { Button, Card, EmptyState, Modal, SearchBar } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Json } from "@/types/database";

// ─── Types ────────────────────────────────────────────────────────────────────

interface FormField {
  name: string;
  label?: string;
  type: string;
  selector: string;
  required: boolean;
  options?: string[];
}

interface FormStructure {
  fields?: FormField[];
  [key: string]: unknown;
}

interface FieldMapping {
  [formFieldName: string]: string | null | undefined;
}

interface TemplateRow {
  id: string;
  funder_id: string | null;
  portal_url: string;
  form_structure: Json | null;
  field_mapping: Json | null;
  is_multi_step: boolean;
  requires_login: boolean;
  requires_file_upload: boolean;
  last_verified_at: string | null;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
  funders: { name: string } | null;
}

interface EditableField extends FormField {
  mapped_kb_field: string;
  skip: boolean;
}

interface PortalVersionGroup {
  portalUrl: string;
  templates: TemplateRow[];
  primary: TemplateRow;
}

interface FunderGroup {
  key: string;
  funderName: string;
  funderId: string | null;
  portals: PortalVersionGroup[];
}

type HealthFilter = "all" | "healthy" | "stale" | "errors";

// ─── Constants ────────────────────────────────────────────────────────────────

const KB_FIELD_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "— not mapped —" },
  { value: "org.name", label: "Org: Name" },
  { value: "org.ein", label: "Org: EIN" },
  { value: "org.website", label: "Org: Website" },
  { value: "org.phone", label: "Org: Phone" },
  { value: "org.mission_statement", label: "Org: Mission Statement" },
  { value: "org.vision_statement", label: "Org: Vision Statement" },
  { value: "org.founded_year", label: "Org: Founded Year" },
  { value: "org.annual_budget", label: "Org: Annual Budget" },
  { value: "org.address", label: "Org: Address" },
  { value: "org.city", label: "Org: City" },
  { value: "org.state", label: "Org: State" },
  { value: "org.zip", label: "Org: ZIP" },
  { value: "org.contact_name", label: "Org: Contact Name" },
  { value: "org.contact_email", label: "Org: Contact Email" },
  { value: "org.contact_title", label: "Org: Contact Title" },
  { value: "org.program_description", label: "Org: Program Description" },
  { value: "org.impact_statement", label: "Org: Impact Statement" },
  { value: "org.501c3_status", label: "Org: 501(c)(3) Status" },
  { value: "org.ntee_code", label: "Org: NTEE Code" },
  { value: "request.amount", label: "Request: Amount" },
  { value: "request.description", label: "Request: Description / Purpose" },
  { value: "request.project_name", label: "Request: Project Name" },
  { value: "request.population_served", label: "Request: Population Served" },
  { value: "request.geographic_area", label: "Request: Geographic Area" },
  { value: "request.timeline", label: "Request: Project Timeline" },
  { value: "request.outcomes", label: "Request: Expected Outcomes" },
  { value: "doc.tax_exemption_letter", label: "Doc: Tax Exemption Letter" },
  { value: "doc.990", label: "Doc: IRS Form 990" },
  { value: "doc.program_description", label: "Doc: Program Description PDF" },
  { value: "doc.financial_statements", label: "Doc: Financial Statements" },
];

const STALE_DAYS = 7;
const OUTDATED_DAYS = 30;

const HEALTH_FILTERS: { key: HealthFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "healthy", label: "Healthy" },
  { key: "stale", label: "Stale" },
  { key: "errors", label: "Errors" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseFormStructure(raw: Json | null): FormField[] {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
  const s = raw as FormStructure;
  if (Array.isArray(s.fields)) return s.fields;
  return [];
}

function parseFieldMapping(raw: Json | null): FieldMapping {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as FieldMapping;
}

function countFields(raw: Json | null): number {
  const fields = parseFormStructure(raw);
  if (fields.length > 0) return fields.length;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return Object.keys(raw as object).length;
  }
  return 0;
}

function isStale(tpl: TemplateRow): boolean {
  if (!tpl.last_verified_at) return true;
  const daysAgo = (Date.now() - new Date(tpl.last_verified_at).getTime()) / 86_400_000;
  return daysAgo > STALE_DAYS;
}

function hasErrors(tpl: TemplateRow): boolean {
  return !tpl.form_structure || countFields(tpl.form_structure) === 0;
}

function truncateUrl(url: string, max = 48): string {
  return url.length <= max ? url : url.slice(0, max) + "…";
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url.slice(0, 30);
  }
}

function groupTemplates(templates: TemplateRow[]): FunderGroup[] {
  const funderMap = new Map<string, {
    name: string;
    funderId: string | null;
    portalMap: Map<string, TemplateRow[]>;
  }>();

  for (const tpl of templates) {
    const funderKey = tpl.funder_id ?? `domain:${extractDomain(tpl.portal_url)}`;
    const funderName = tpl.funders?.name ?? extractDomain(tpl.portal_url);

    if (!funderMap.has(funderKey)) {
      funderMap.set(funderKey, {
        name: funderName,
        funderId: tpl.funder_id,
        portalMap: new Map(),
      });
    }

    const funder = funderMap.get(funderKey)!;
    if (!funder.portalMap.has(tpl.portal_url)) {
      funder.portalMap.set(tpl.portal_url, []);
    }
    funder.portalMap.get(tpl.portal_url)!.push(tpl);
  }

  const groups: FunderGroup[] = [];
  for (const [key, funder] of funderMap) {
    const portals: PortalVersionGroup[] = [];
    for (const [portalUrl, tpls] of funder.portalMap) {
      const first = tpls[0];
      if (!first) continue;
      portals.push({ portalUrl, templates: tpls, primary: first });
    }
    if (portals.length > 0) {
      groups.push({
        key,
        funderName: funder.name,
        funderId: funder.funderId,
        portals,
      });
    }
  }
  return groups;
}

function healthBadge(tpl: TemplateRow): { color: BadgeColor; label: string } {
  if (hasErrors(tpl)) return { color: "red", label: "No fields" };
  if (!tpl.last_verified_at) return { color: "red", label: "Unverified" };
  const daysAgo =
    (Date.now() - new Date(tpl.last_verified_at).getTime()) / 86_400_000;
  if (daysAgo <= STALE_DAYS) return { color: "teal", label: "Verified" };
  if (daysAgo <= OUTDATED_DAYS) return { color: "yellow", label: "Stale" };
  return { color: "red", label: "Outdated" };
}

function coverageBadge(tpl: TemplateRow): { color: BadgeColor; label: string } {
  const total = countFields(tpl.form_structure);
  if (total === 0) return { color: "gray", label: "0 fields" };
  const mapping = parseFieldMapping(tpl.field_mapping);
  const mapped = Object.values(mapping).filter(
    (v) => v && v !== "__skip__",
  ).length;
  if (mapped >= total) return { color: "teal", label: `${total}/${total} fields` };
  if (mapped === 0) return { color: "red", label: `0/${total} fields` };
  const pct = Math.round((mapped / total) * 100);
  return { color: "yellow", label: `${mapped}/${total} (${pct}%)` };
}

// Build editable fields array by merging form_structure + field_mapping
function buildEditableFields(tpl: TemplateRow): EditableField[] {
  const fields = parseFormStructure(tpl.form_structure);
  const mapping = parseFieldMapping(tpl.field_mapping);

  if (fields.length > 0) {
    return fields.map((f) => ({
      ...f,
      mapped_kb_field: (mapping[f.name] === "__skip__" ? "" : mapping[f.name]) ?? "",
      skip: mapping[f.name] === "__skip__",
    }));
  }

  // Fallback: field_mapping keys with no form_structure detail
  return Object.entries(mapping).map(([name, kbField]) => ({
    name,
    type: "text",
    selector: "",
    required: false,
    mapped_kb_field: (kbField === "__skip__" ? "" : kbField) ?? "",
    skip: kbField === "__skip__",
  }));
}

// ─── Diff display ─────────────────────────────────────────────────────────────

interface FieldDiff {
  name: string;
  change: "added" | "removed" | "changed";
  before?: string;
  after?: string;
}

function computeDiff(before: FieldMapping, after: FieldMapping): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  const allKeys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const key of allKeys) {
    const b = before[key];
    const a = after[key];
    if (b === undefined) diffs.push({ name: key, change: "added", after: a ?? undefined });
    else if (a === undefined) diffs.push({ name: key, change: "removed", before: b ?? undefined });
    else if (b !== a) diffs.push({ name: key, change: "changed", before: b ?? undefined, after: a ?? undefined });
  }
  return diffs;
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function FormTemplatesPage() {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [healthFilter, setHealthFilter] = useState<HealthFilter>("all");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [expandedVersions, setExpandedVersions] = useState<Set<string>>(new Set());

  const [bulkReanalyzing, setBulkReanalyzing] = useState(false);
  const [bulkResult, setBulkResult] = useState<string | null>(null);

  const [detailTemplate, setDetailTemplate] = useState<TemplateRow | null>(null);
  const [editableFields, setEditableFields] = useState<EditableField[]>([]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [reanalyzing, setReanalyzing] = useState(false);
  const [reanalyzeDiff, setReanalyzeDiff] = useState<FieldDiff[] | null>(null);
  const [reanalyzeError, setReanalyzeError] = useState<string | null>(null);

  const [testTemplate, setTestTemplate] = useState<TemplateRow | null>(null);
  const [testRunning, setTestRunning] = useState(false);
  const [testResult, setTestResult] = useState<{
    screenshotDataUrl: string;
    fieldValues: Record<string, string>;
  } | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    try {
      const { data, error: err } = await supabase
        .from("form_templates")
        .select("*, funders(name)")
        .order("updated_at", { ascending: false });
      if (err) throw err;
      setTemplates((data ?? []) as unknown as TemplateRow[]);
      setError(null);
    } catch {
      setError("Could not load form templates.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    let result = templates;
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (t) =>
          (t.funders?.name ?? "").toLowerCase().includes(q) ||
          t.portal_url.toLowerCase().includes(q),
      );
    }
    switch (healthFilter) {
      case "healthy":
        return result.filter((t) => !hasErrors(t) && !isStale(t));
      case "stale":
        return result.filter(isStale);
      case "errors":
        return result.filter(hasErrors);
      default:
        return result;
    }
  }, [templates, search, healthFilter]);

  const groups = useMemo(() => groupTemplates(filtered), [filtered]);

  function toggleGroup(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleVersions(key: string) {
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function openDetail(tpl: TemplateRow) {
    setDetailTemplate(tpl);
    setEditableFields(buildEditableFields(tpl));
    setSaveError(null);
    setSaveSuccess(false);
    setReanalyzeDiff(null);
    setReanalyzeError(null);
  }

  function closeDetail() {
    setDetailTemplate(null);
    setReanalyzeDiff(null);
  }

  function updateFieldMapping(index: number, value: string) {
    setEditableFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, mapped_kb_field: value, skip: false } : f)),
    );
  }

  function updateSelector(index: number, value: string) {
    setEditableFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, selector: value } : f)),
    );
  }

  function toggleSkip(index: number) {
    setEditableFields((prev) =>
      prev.map((f, i) =>
        i === index ? { ...f, skip: !f.skip, mapped_kb_field: !f.skip ? "__skip__" : "" } : f,
      ),
    );
  }

  async function handleSave() {
    if (!detailTemplate) return;
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    const supabase = createClient();
    try {
      const newMapping: Record<string, string | null> = {};
      for (const f of editableFields) {
        newMapping[f.name] = f.skip ? "__skip__" : (f.mapped_kb_field || null);
      }
      const newStructure: FormStructure = {
        ...(typeof detailTemplate.form_structure === "object" &&
        !Array.isArray(detailTemplate.form_structure) &&
        detailTemplate.form_structure !== null
          ? (detailTemplate.form_structure as FormStructure)
          : {}),
        fields: editableFields.map(({ mapped_kb_field: _m, skip: _s, ...rest }) => rest),
      };
      const { error: err } = await supabase
        .from("form_templates")
        .update({
          field_mapping: newMapping as unknown as Json,
          form_structure: newStructure as unknown as Json,
          updated_at: new Date().toISOString(),
        })
        .eq("id", detailTemplate.id);
      if (err) throw err;
      setSaveSuccess(true);
      await load();
      setDetailTemplate((prev) =>
        prev
          ? {
              ...prev,
              field_mapping: newMapping as unknown as Json,
              form_structure: newStructure as unknown as Json,
            }
          : null,
      );
    } catch {
      setSaveError("Could not save template. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReanalyze() {
    if (!detailTemplate?.funder_id) return;
    setReanalyzing(true);
    setReanalyzeDiff(null);
    setReanalyzeError(null);
    const beforeMapping = parseFieldMapping(detailTemplate.field_mapping);
    try {
      const res = await fetch("/api/agents/form-analyzer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funderIds: [detailTemplate.funder_id] }),
      });
      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setReanalyzeError(err.error ?? "Re-analysis failed. Please try again.");
        return;
      }
      await load();
      const supabase = createClient();
      const { data } = await supabase
        .from("form_templates")
        .select("*, funders(name)")
        .eq("id", detailTemplate.id)
        .single();
      if (data) {
        const refreshed = data as unknown as TemplateRow;
        const afterMapping = parseFieldMapping(refreshed.field_mapping);
        const diff = computeDiff(beforeMapping, afterMapping);
        setReanalyzeDiff(diff);
        setDetailTemplate(refreshed);
        setEditableFields(buildEditableFields(refreshed));
      }
    } catch {
      setReanalyzeError("Could not reach the form analyzer. Please try again.");
    } finally {
      setReanalyzing(false);
    }
  }

  async function handleBulkReanalyze() {
    const staleTemplates = templates.filter(isStale);
    const funderIds = staleTemplates
      .map((t) => t.funder_id)
      .filter((id): id is string => id !== null);
    if (funderIds.length === 0) return;
    setBulkReanalyzing(true);
    setBulkResult(null);
    try {
      const res = await fetch("/api/agents/form-analyzer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ funderIds }),
      });
      if (res.ok) {
        await load();
        setBulkResult(
          `Re-analyzed ${funderIds.length} stale template${funderIds.length !== 1 ? "s" : ""}.`,
        );
      } else {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        setBulkResult(err.error ?? "Re-analysis failed.");
      }
    } catch {
      setBulkResult("Could not reach the form analyzer.");
    } finally {
      setBulkReanalyzing(false);
    }
  }

  function openTestModal(tpl: TemplateRow) {
    setTestTemplate(tpl);
    setTestResult(null);
    setTestError(null);
    setTestRunning(false);
  }

  function closeTestModal() {
    setTestTemplate(null);
    setTestResult(null);
    setTestError(null);
    setTestRunning(false);
  }

  async function handleRunDryTest() {
    if (!testTemplate) return;
    setTestRunning(true);
    setTestError(null);
    setTestResult(null);
    try {
      const res = await fetch("/api/autoapply/templates/test", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ templateId: testTemplate.id }),
      });
      const json = (await res.json()) as {
        screenshotDataUrl?: string;
        fieldValues?: Record<string, string>;
        error?: string;
      };
      if (!res.ok) {
        setTestError(json.error ?? "Dry test failed.");
        return;
      }
      setTestResult({
        screenshotDataUrl: json.screenshotDataUrl ?? "",
        fieldValues: json.fieldValues ?? {},
      });
    } catch {
      setTestError(
        "Could not connect to the test runner. Make sure you are on the Railway worker environment.",
      );
    } finally {
      setTestRunning(false);
    }
  }

  function handleNeedsFixing() {
    if (!testTemplate) return;
    const tpl = testTemplate;
    closeTestModal();
    openDetail(tpl);
  }

  const staleCount = templates.filter(isStale).length;

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
            Form Templates
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Cached portal form structures and field mappings. Edit mappings to improve submission accuracy.
          </p>
        </div>
      </div>

      {/* Top bar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-48 flex-1">
          <SearchBar
            onSearch={setSearch}
            placeholder="Search funders or portal URLs…"
            aria-label="Search templates"
          />
        </div>
        <div className="flex gap-1 rounded-lg border border-navy-200 bg-navy-50 p-1">
          {HEALTH_FILTERS.map(({ key, label }) => (
            <button
              key={key}
              type="button"
              onClick={() => setHealthFilter(key)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                healthFilter === key
                  ? "bg-white text-navy-900 shadow-sm"
                  : "text-navy-500 hover:text-navy-700"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        {staleCount > 0 && (
          <Button
            variant="secondary"
            onClick={() => void handleBulkReanalyze()}
            isLoading={bulkReanalyzing}
            disabled={bulkReanalyzing}
          >
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Re-analyze Stale ({staleCount})
          </Button>
        )}
        <Button variant="secondary">
          <Plus className="mr-1.5 h-4 w-4" />
          Add Portal
        </Button>
      </div>

      {bulkResult && (
        <div
          role="status"
          className="rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-700"
        >
          {bulkResult}
        </div>
      )}

      {/* Funder cards */}
      {error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-500">
          {error}
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 py-6 text-sm text-navy-400">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading templates…
        </div>
      ) : groups.length === 0 ? (
        <Card noPadding>
          <div className="p-6">
            <EmptyState
              icon={FileSearch}
              title="No templates"
              description={
                healthFilter === "all" && !search
                  ? 'Run "Analyze Forms" on queued funders to generate form templates.'
                  : "No templates match this filter."
              }
            />
          </div>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => {
            const primaryPortal = group.portals[0];
            if (!primaryPortal) return null;
            const primaryTpl = primaryPortal.primary;
            const health = healthBadge(primaryTpl);
            const coverage = coverageBadge(primaryTpl);
            const isExpanded = expandedGroups.has(group.key);
            const mappedCount = Object.values(
              parseFieldMapping(primaryTpl.field_mapping),
            ).filter((v) => v && v !== "__skip__").length;

            return (
              <div
                key={group.key}
                className="overflow-hidden rounded-xl border border-border bg-white shadow-sm"
              >
                {/* Card header — click to expand */}
                <button
                  type="button"
                  onClick={() => toggleGroup(group.key)}
                  className="flex w-full items-start gap-3 px-5 py-4 text-left transition hover:bg-navy-50/50"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-navy-900">
                        {group.funderName}
                      </span>
                      <Badge color={health.color}>{health.label}</Badge>
                      <Badge color={coverage.color}>{coverage.label}</Badge>
                      {group.portals.length > 1 && (
                        <span className="text-xs text-navy-400">
                          {group.portals.length} portals
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex items-center gap-1">
                      <a
                        href={primaryPortal.portalUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 text-xs text-teal-500 hover:underline"
                      >
                        <span className="max-w-xs truncate">
                          {truncateUrl(primaryPortal.portalUrl)}
                        </span>
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-2 text-xs text-navy-500">
                      <span>{mappedCount} fields mapped</span>
                      <span>·</span>
                      <span>
                        Verified{" "}
                        {primaryTpl.last_verified_at
                          ? new Date(primaryTpl.last_verified_at).toLocaleDateString()
                          : "never"}
                      </span>
                      {primaryPortal.templates.length > 1 && (
                        <>
                          <span>·</span>
                          <span>{primaryPortal.templates.length} cached versions</span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Flags */}
                  <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                    {primaryTpl.requires_login && (
                      <Badge variant="warning">Login</Badge>
                    )}
                    {primaryTpl.requires_file_upload && (
                      <Badge variant="info">Files</Badge>
                    )}
                    {primaryTpl.is_multi_step && (
                      <Badge variant="info">Multi-step</Badge>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex shrink-0 items-center gap-2 pt-0.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        openTestModal(primaryTpl);
                      }}
                    >
                      <FlaskConical className="mr-1 h-3.5 w-3.5" />
                      Test
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={(e) => {
                        e.stopPropagation();
                        openDetail(primaryTpl);
                      }}
                    >
                      Edit
                    </Button>
                    <ChevronDown
                      className={`h-4 w-4 text-navy-400 transition-transform ${
                        isExpanded ? "rotate-180" : ""
                      }`}
                    />
                  </div>
                </button>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t border-navy-100">
                    {group.portals.map((portal) => {
                      const versionsKey = `${group.key}:${portal.portalUrl}`;
                      const versionsExpanded = expandedVersions.has(versionsKey);
                      const fields = parseFormStructure(portal.primary.form_structure);
                      const mapping = parseFieldMapping(portal.primary.field_mapping);
                      const portalHealth = healthBadge(portal.primary);
                      const portalCoverage = coverageBadge(portal.primary);

                      return (
                        <div
                          key={portal.portalUrl}
                          className="border-b border-navy-50 px-5 py-4 last:border-b-0"
                        >
                          {/* Per-portal header (only shown when funder has multiple portals) */}
                          {group.portals.length > 1 && (
                            <div className="mb-3 flex flex-wrap items-center gap-2">
                              <a
                                href={portal.portalUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-teal-500 hover:underline"
                              >
                                <span className="truncate">
                                  {truncateUrl(portal.portalUrl)}
                                </span>
                                <ExternalLink className="h-3 w-3 shrink-0" />
                              </a>
                              <Badge color={portalHealth.color}>
                                {portalHealth.label}
                              </Badge>
                              <Badge color={portalCoverage.color}>
                                {portalCoverage.label}
                              </Badge>
                            </div>
                          )}

                          {/* Field mappings preview table */}
                          {fields.length === 0 ? (
                            <p className="mb-3 text-sm text-navy-400">
                              No fields detected — click Edit and then Re-Analyze to scan the portal form.
                            </p>
                          ) : (
                            <div className="mb-3 overflow-x-auto rounded-lg border border-navy-200">
                              <table className="min-w-full divide-y divide-navy-100 text-xs">
                                <thead>
                                  <tr className="bg-sidebar">
                                    <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-white">
                                      Field
                                    </th>
                                    <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-white">
                                      Type
                                    </th>
                                    <th className="px-3 py-2 text-left font-medium uppercase tracking-wide text-white">
                                      KB Mapping
                                    </th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-navy-100 bg-white">
                                  {fields.map((f) => (
                                    <tr key={f.name}>
                                      <td className="px-3 py-1.5 font-medium text-navy-800">
                                        {f.name}
                                        {f.required && (
                                          <span className="ml-1 text-red-400" aria-hidden>
                                            *
                                          </span>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5">
                                        <span className="rounded bg-navy-100 px-1.5 py-0.5 font-mono text-navy-600">
                                          {f.type}
                                        </span>
                                      </td>
                                      <td className="px-3 py-1.5 font-mono text-navy-500">
                                        {mapping[f.name] === "__skip__" ? (
                                          <span className="text-navy-400">skipped</span>
                                        ) : mapping[f.name] ? (
                                          String(mapping[f.name])
                                        ) : (
                                          <span className="text-red-400">not mapped</span>
                                        )}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}

                          {/* Actions */}
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openTestModal(portal.primary)}
                            >
                              <FlaskConical className="mr-1 h-3.5 w-3.5" />
                              Test
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => openDetail(portal.primary)}
                            >
                              Edit Mappings
                            </Button>
                          </div>

                          {/* Version history */}
                          {portal.templates.length > 1 && (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() => toggleVersions(versionsKey)}
                                className="flex items-center gap-1.5 text-xs text-navy-500 hover:text-navy-700"
                              >
                                <ChevronRight
                                  className={`h-3.5 w-3.5 transition-transform ${
                                    versionsExpanded ? "rotate-90" : ""
                                  }`}
                                />
                                {portal.templates.length} cached versions
                              </button>
                              {versionsExpanded && (
                                <div className="mt-2 space-y-1">
                                  {portal.templates.map((tpl, idx) => (
                                    <div
                                      key={tpl.id}
                                      className="flex items-center gap-3 rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-600"
                                    >
                                      <span className="text-navy-400">
                                        v{portal.templates.length - idx}
                                      </span>
                                      <span>
                                        {new Date(tpl.updated_at).toLocaleString()}
                                      </span>
                                      <span className="text-navy-300">·</span>
                                      <span>
                                        {countFields(tpl.form_structure)} fields
                                      </span>
                                      {idx === 0 && (
                                        <Badge variant="info" className="ml-auto">
                                          current
                                        </Badge>
                                      )}
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Test Template Modal */}
      <Modal
        isOpen={testTemplate !== null}
        onClose={closeTestModal}
        title={
          testTemplate
            ? `Test — ${testTemplate.funders?.name ?? "Template"}`
            : "Test Template"
        }
        description={testTemplate?.portal_url ?? undefined}
        size="xl"
        footer={
          <div className="flex w-full items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                onClick={() => void handleRunDryTest()}
                isLoading={testRunning}
                disabled={testRunning}
              >
                <FlaskConical className="mr-1.5 h-4 w-4" />
                {testRunning ? "Running…" : "Run Dry Test"}
              </Button>
              {testResult && (
                <span className="text-xs text-navy-400">Screenshot captured</span>
              )}
            </div>
            <div className="flex gap-2">
              {testResult ? (
                <>
                  <Button variant="secondary" onClick={handleNeedsFixing}>
                    Needs Fixing
                  </Button>
                  <Button onClick={closeTestModal}>
                    <CheckCircle2 className="mr-1.5 h-4 w-4" />
                    Looks Good
                  </Button>
                </>
              ) : (
                <Button variant="secondary" onClick={closeTestModal}>
                  Cancel
                </Button>
              )}
            </div>
          </div>
        }
      >
        {testTemplate && (
          <div className="space-y-4">
            <div className="flex items-center gap-2 rounded-lg border border-navy-100 bg-navy-50 px-4 py-3">
              <ExternalLink className="h-4 w-4 shrink-0 text-navy-400" />
              <a
                href={testTemplate.portal_url}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate text-sm text-teal-600 hover:underline"
              >
                {testTemplate.portal_url}
              </a>
            </div>

            {testError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {testError}
              </div>
            )}

            {!testResult && !testRunning && (
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
                  Field Mappings
                </p>
                {(() => {
                  const mapping = parseFieldMapping(testTemplate.field_mapping);
                  const entries = Object.entries(mapping).filter(
                    ([, v]) => v && v !== "__skip__",
                  );
                  if (entries.length === 0) {
                    return (
                      <p className="text-sm text-navy-400">
                        No field mappings configured. Edit the template first.
                      </p>
                    );
                  }
                  return (
                    <div className="overflow-auto rounded-lg border border-navy-200">
                      <table className="min-w-full divide-y divide-navy-100 text-sm">
                        <thead>
                          <tr className="bg-sidebar">
                            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-white">
                              Form Field
                            </th>
                            <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-white">
                              KB Key
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-navy-100 bg-white">
                          {entries.map(([field, kbKey]) => (
                            <tr key={field}>
                              <td className="px-3 py-2 font-medium text-navy-800">
                                {field}
                              </td>
                              <td className="px-3 py-2 font-mono text-xs text-navy-500">
                                {kbKey}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
                <p className="mt-2 text-xs text-navy-400">
                  Click "Run Dry Test" to navigate to the portal, fill the form with live KB values, and capture a screenshot — without submitting.
                </p>
              </div>
            )}

            {testRunning && (
              <div className="flex items-center justify-center gap-3 rounded-lg border border-navy-200 py-12">
                <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
                <p className="text-sm text-navy-500">
                  Launching browser and filling form…
                </p>
              </div>
            )}

            {testResult && (
              <div className="space-y-4">
                <div>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
                    Resolved Values
                  </p>
                  <div className="overflow-auto rounded-lg border border-navy-200">
                    <table className="min-w-full divide-y divide-navy-100 text-sm">
                      <thead>
                        <tr className="bg-sidebar">
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-white">
                            Form Field
                          </th>
                          <th className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-white">
                            Value Used
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-navy-100 bg-white">
                        {Object.entries(testResult.fieldValues).map(
                          ([field, value]) => (
                            <tr key={field}>
                              <td className="px-3 py-2 font-medium text-navy-800">
                                {field}
                              </td>
                              <td className="max-w-xs truncate px-3 py-2 text-navy-600">
                                {value}
                              </td>
                            </tr>
                          ),
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                {testResult.screenshotDataUrl && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
                      Form Screenshot
                    </p>
                    <div className="overflow-hidden rounded-lg border border-navy-200">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={testResult.screenshotDataUrl}
                        alt="Screenshot of the filled portal form"
                        className="w-full"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Detail / Edit Modal */}
      <Modal
        isOpen={detailTemplate !== null}
        onClose={closeDetail}
        title={
          detailTemplate
            ? `${detailTemplate.funders?.name ?? "Template"} — Field Mappings`
            : "Template"
        }
        description={detailTemplate?.portal_url ?? undefined}
        size="xl"
        footer={
          detailTemplate ? (
            <div className="flex w-full items-center justify-between gap-3">
              <div className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    closeDetail();
                    openTestModal(detailTemplate);
                  }}
                >
                  <FlaskConical className="mr-1.5 h-3.5 w-3.5" />
                  Test Template
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void handleReanalyze()}
                  isLoading={reanalyzing}
                  disabled={reanalyzing || !detailTemplate.funder_id}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Re-Analyze
                </Button>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" onClick={closeDetail}>
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleSave()}
                  isLoading={saving}
                  disabled={saving}
                >
                  <Save className="mr-1.5 h-4 w-4" />
                  Save
                </Button>
              </div>
            </div>
          ) : undefined
        }
      >
        {detailTemplate && (
          <div className="space-y-4">
            {saveError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {saveError}
              </div>
            )}
            {saveSuccess && (
              <div
                role="status"
                className="flex items-center gap-2 rounded-lg border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-700"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                Template saved successfully.
              </div>
            )}
            {reanalyzeError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {reanalyzeError}
              </div>
            )}

            {reanalyzeDiff !== null && (
              <div className="rounded-lg border border-navy-200 bg-navy-50 p-4">
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-navy-500">
                  Re-analysis Changes
                </p>
                {reanalyzeDiff.length === 0 ? (
                  <p className="text-sm text-navy-500">
                    No changes detected — template is up to date.
                  </p>
                ) : (
                  <ul className="space-y-1">
                    {reanalyzeDiff.map((d, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm">
                        {d.change === "added" && (
                          <Badge variant="info">+added</Badge>
                        )}
                        {d.change === "removed" && (
                          <Badge variant="error">−removed</Badge>
                        )}
                        {d.change === "changed" && (
                          <Badge variant="warning">~changed</Badge>
                        )}
                        <code className="font-mono text-xs text-navy-700">
                          {d.name}
                        </code>
                        {d.change === "changed" && (
                          <span className="text-navy-400">
                            {d.before ?? "—"} → {d.after ?? "—"}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-4 rounded-lg border border-navy-100 bg-navy-50 px-4 py-3 text-xs text-navy-500">
              <span>
                <span className="font-medium text-navy-700">Multi-step:</span>{" "}
                {detailTemplate.is_multi_step ? "Yes" : "No"}
              </span>
              <span>
                <span className="font-medium text-navy-700">Requires login:</span>{" "}
                {detailTemplate.requires_login ? "Yes" : "No"}
              </span>
              <span>
                <span className="font-medium text-navy-700">File uploads:</span>{" "}
                {detailTemplate.requires_file_upload ? "Yes" : "No"}
              </span>
              <span>
                <span className="font-medium text-navy-700">Last verified:</span>{" "}
                {detailTemplate.last_verified_at
                  ? new Date(detailTemplate.last_verified_at).toLocaleString()
                  : "—"}
              </span>
            </div>

            {editableFields.length === 0 ? (
              <div className="rounded-lg border border-navy-100 px-4 py-6 text-center text-sm text-navy-400">
                No field structure detected. Click "Re-Analyze" to scan the portal form.
              </div>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-navy-200">
                <table className="min-w-full divide-y divide-navy-100 text-sm">
                  <thead>
                    <tr className="bg-sidebar">
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-white">
                        Form Field
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-white">
                        Type
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-white">
                        Required
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-white">
                        CSS Selector
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-white">
                        KB Field Mapping
                      </th>
                      <th className="px-4 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-white">
                        Skip
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-navy-100 bg-white">
                    {editableFields.map((f, i) => (
                      <tr
                        key={i}
                        className={f.skip ? "bg-navy-50 opacity-60" : ""}
                      >
                        <td className="px-4 py-2.5">
                          <div>
                            <p className="font-medium text-navy-900">{f.name}</p>
                            {f.label && f.label !== f.name && (
                              <p className="text-xs text-navy-400">{f.label}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className="inline-flex items-center rounded bg-navy-100 px-2 py-0.5 font-mono text-xs text-navy-600">
                            {f.type}
                          </span>
                        </td>
                        <td className="px-4 py-2.5">
                          {f.required ? (
                            <span className="text-red-500">●</span>
                          ) : (
                            <span className="text-navy-300">○</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5">
                          <input
                            type="text"
                            value={f.selector}
                            onChange={(e) => updateSelector(i, e.target.value)}
                            placeholder="#field-id or .class-name"
                            disabled={f.skip}
                            className="w-48 rounded border border-navy-200 bg-white px-2 py-1 font-mono text-xs text-navy-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            value={f.skip ? "" : f.mapped_kb_field}
                            onChange={(e) => updateFieldMapping(i, e.target.value)}
                            disabled={f.skip}
                            className="w-56 rounded border border-navy-200 bg-white px-2 py-1 text-xs text-navy-700 focus:border-teal-400 focus:outline-none focus:ring-1 focus:ring-teal-400 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            {KB_FIELD_OPTIONS.map((opt) => (
                              <option key={opt.value} value={opt.value}>
                                {opt.label}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-2.5">
                          <button
                            type="button"
                            onClick={() => toggleSkip(i)}
                            aria-label={f.skip ? `Un-skip ${f.name}` : `Skip ${f.name}`}
                            className={`rounded p-1 transition ${
                              f.skip
                                ? "bg-navy-200 text-navy-500 hover:bg-navy-300"
                                : "text-navy-300 hover:bg-navy-100 hover:text-navy-600"
                            }`}
                            title={
                              f.skip
                                ? "Click to un-skip"
                                : "Skip this field (AutoApply will ignore it)"
                            }
                          >
                            {f.skip ? (
                              <X className="h-3.5 w-3.5" />
                            ) : (
                              <SkipForward className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-navy-400">
              Changes are saved to the template and used on the next AutoApply submission for this funder.
              Skipped fields are ignored during form fill.
            </p>
          </div>
        )}
      </Modal>
    </div>
  );
}
