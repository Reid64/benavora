"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Check, Clipboard, Dna, Download, Mail as MailIcon, RefreshCw, Sparkles, Wand2 } from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
  Select,
} from "@/components/ui";
import { TemplateSelector } from "@/components/draft-generator/TemplateSelector";
import { DraftEditor } from "@/components/draft-generator/DraftEditor";
import { ConfidenceIndicator } from "@/components/draft-generator/ConfidenceIndicator";
import { KnowledgePreview } from "@/components/draft-generator/KnowledgePreview";
import {
  DraftsHistoryPanel,
  type DraftVersionItem,
} from "@/components/draft-generator/DraftsHistoryPanel";
import { RubricPanel } from "@/components/intelligence/RubricPanel";
import { GrantDNACard, type GrantDNAResult } from "@/components/intelligence/GrantDNACard";
import {
  LogicModelView,
  type LogicModelData,
} from "@/components/intelligence/LogicModelView";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import type {
  BudgetApiResult,
  BudgetTableItem,
  DraftResult,
  DraftTemplateType,
  HumanizationStatus,
  HumanizeResult,
  KnowledgeSource,
  RubricDimension,
} from "@/types/ai";
import type { Json, Tables } from "@/types/database";

type OpportunityOption = { id: string; name: string; category: string };
type ProgramOption = { id: string; name: string };

/** Client-side confidence re-score — same algorithm as /api/ai/draft's computeConfidence. */
function computeRescoreConfidence(
  text: string,
  kbCount: number,
  provenCount: number,
): number {
  const needsInput = (text.match(/\[NEEDS INPUT/gi) ?? []).length;
  if (kbCount === 0) return Math.max(55, 65 - needsInput * 3);
  let score = 92;
  if (provenCount === 0) score -= 4;
  if (kbCount < 3) score -= 12;
  score -= needsInput * 3;
  return Math.max(0, Math.min(100, score));
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);
}

/** Numbered step header — a filled circle instead of a plain "N." prefix. */
function StepTitle({ step, children }: { step: number; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
        {step}
      </span>
      {children}
    </span>
  );
}

/** Badge styling for the active draft's humanization status (mirrors history). */
const HUMANIZATION_BADGE: Record<
  HumanizationStatus,
  { label: string; color: "gray" | "green" | "yellow" | "red" }
> = {
  not_humanized: { label: "Not humanized", color: "gray" },
  pending: { label: "Humanizing...", color: "yellow" },
  humanized: { label: "Humanized", color: "green" },
  failed: { label: "Humanize failed", color: "red" },
};

/** Defensively parse draft_versions.knowledge_sources (jsonb) into sources. */
function parseSources(value: Json | null): KnowledgeSource[] {
  if (!Array.isArray(value)) return [];
  const out: KnowledgeSource[] = [];
  for (const entry of value) {
    if (
      entry &&
      typeof entry === "object" &&
      !Array.isArray(entry) &&
      typeof entry.id === "string" &&
      typeof entry.title === "string" &&
      (entry.kind === "knowledge_base" || entry.kind === "proven_narrative")
    ) {
      out.push({ id: entry.id, kind: entry.kind, title: entry.title });
    }
  }
  return out;
}

// --- Section parsing & scoring ---
type DraftSection = { name: string; text: string };

function parseDraftSections(text: string): DraftSection[] {
  const sections: DraftSection[] = [];
  let currentName = "";
  let currentLines: string[] = [];

  for (const line of text.split("\n")) {
    const mdHeader = line.match(/^#{1,3}\s+(.+)/);
    const capsHeader = line.match(/^([A-Z][A-Z\s\-]{5,}):?\s*$/);
    const header = mdHeader?.[1]?.trim() ?? capsHeader?.[1]?.trim();

    if (header) {
      if (currentLines.some((l) => l.trim()) && currentName) {
        sections.push({ name: currentName, text: currentLines.join("\n") });
      }
      currentName = header;
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }
  if (currentLines.some((l) => l.trim()) && currentName) {
    sections.push({ name: currentName, text: currentLines.join("\n") });
  }
  return sections.slice(0, 10);
}

function scoreSectionText(sectionText: string): { score: number; gaps: number; words: number } {
  const words = (sectionText.match(/\b\w+\b/g) ?? []).length;
  const gaps = (sectionText.match(/\[NEEDS INPUT/gi) ?? []).length;
  if (words < 5) return { score: 0, gaps, words };
  let score = 90;
  score -= gaps * 8;
  if (words < 50) score -= 10;
  if (words < 20) score -= 10;
  return { score: Math.max(5, Math.min(100, score)), gaps, words };
}

function sectionSuggestion(score: number, gaps: number): string {
  if (gaps > 0) return `Fill ${gaps} input gap${gaps !== 1 ? "s" : ""} to complete this section`;
  if (score >= 80) return "Well-developed section";
  if (score >= 60) return "Expand with specific outcomes or evidence";
  return "Needs development — add concrete details";
}

// --- Readability metrics ---
function countSyllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (w.length <= 3) return 1;
  const trimmed = w.replace(/e$/, "");
  const vowelGroups = trimmed.match(/[aeiouy]+/g);
  return Math.max(1, vowelGroups?.length ?? 1);
}

type ReadabilityMetrics = { gradeLevel: number; passivePercent: number; wordCount: number };

function computeReadabilityMetrics(text: string): ReadabilityMetrics | null {
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 5);
  const words = text.match(/\b[a-zA-Z']+\b/g) ?? [];
  if (words.length < 10 || sentences.length < 2) return null;

  const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
  const avgWords = words.length / sentences.length;
  const avgSyllables = syllables / words.length;
  const gradeLevel = Math.max(1, Math.min(20, 0.39 * avgWords + 11.8 * avgSyllables - 15.59));

  const passiveMatches = (text.match(/\b(was|were|been|being|is|are|am|be)\s+\w+(?:ed|en)\b/gi) ?? []).length;
  const passivePercent = Math.min(100, (passiveMatches / sentences.length) * 100);

  return { gradeLevel, passivePercent, wordCount: words.length };
}

/** Map a draft_versions row to the shape the history panel + editor consume. */
function mapVersion(row: Tables<"draft_versions">): DraftVersionItem {
  return {
    id: row.id,
    versionNumber: row.version_number,
    templateType: row.template_type,
    content: row.content,
    confidenceScore: row.confidence_score,
    sources: parseSources(row.knowledge_sources as Json | null),
    humanizationStatus: row.humanization_status,
    source: row.source,
    createdAt: row.created_at,
  };
}

/**
 * Draft Generator - template selection + generation flow (BLUEPRINT §4.8).
 * Pick an opportunity and template, generate a draft grounded in the Knowledge
 * Base, review the confidence and sources, then save it onto an application
 * record and open the editor. organization_id is never sent from the client -
 * reads are RLS-scoped and writes derive it from the session profile.
 *
 * Every generated draft is auto-saved to draft_versions by /api/ai/draft, so
 * the last draft is restored on return and full per-opportunity history (view,
 * compare, revert) is available in the side panel.
 */
export default function DraftGeneratorPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  // Deep-link target, e.g. from a narrative's usage history
  // (/draft-generator?opportunity=<id>). Preselects that opportunity below.
  const requestedOpportunityId = searchParams.get("opportunity");

  const [opportunities, setOpportunities] = useState<OpportunityOption[]>([]);
  const [programs, setPrograms] = useState<ProgramOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [opportunityId, setOpportunityId] = useState("");
  const [programId, setProgramId] = useState("");
  const [templateType, setTemplateType] = useState<DraftTemplateType | null>(
    null,
  );

  const [generating, setGenerating] = useState(false);
  const [humanizing, setHumanizing] = useState(false);
  const [draftText, setDraftText] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);
  const [humanizationStatus, setHumanizationStatus] =
    useState<HumanizationStatus>("not_humanized");
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rescoreMessage, setRescoreMessage] = useState<string | null>(null);

  const [budgetTable, setBudgetTable] = useState<BudgetTableItem[]>([]);
  const [totalRequested, setTotalRequested] = useState<number | null>(null);

  const [rubric, setRubric] = useState<RubricDimension[] | null>(null);
  const [rubricInferred, setRubricInferred] = useState(false);

  // Program logic model the API used to ground the program-design section
  // (template-based or AI-generated). GeneratedLogicModel/DraftLogicModel carry
  // extra metadata, but they extend LogicModelData so they render directly.
  const [logicModel, setLogicModel] = useState<LogicModelData | null>(null);

  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [copiedToClipboard, setCopiedToClipboard] = useState(false);

  const [versions, setVersions] = useState<DraftVersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

  const [dnaScore, setDnaScore] = useState<GrantDNAResult | null>(null);
  const [dnaScoring, setDnaScoring] = useState(false);

  const generatingRef = useRef(false);
  const humanizingRef = useRef(false);

  const runDNAScore = useCallback(
    async (text: string, category: string, grantType?: string) => {
      if (!text.trim()) return;
      setDnaScoring(true);
      try {
        const secs = parseDraftSections(text);
        const sectionsRecord: Record<string, string> = {};
        for (const s of secs) {
          sectionsRecord[s.name] = s.text;
        }
        if (Object.keys(sectionsRecord).length === 0) {
          sectionsRecord["full_draft"] = text;
        }
        const res = await fetch("/api/intelligence/grant-dna", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ sections: sectionsRecord, category, grant_type: grantType }),
        });
        if (res.ok) {
          const data = (await res.json()) as GrantDNAResult;
          setDnaScore(data);
        }
      } catch {
        // DNA scoring is supplementary — silent failure is acceptable.
      } finally {
        setDnaScoring(false);
      }
    },
    [],
  );

  // Load a saved version into the editor + review sidebar.
  const loadVersion = useCallback((version: DraftVersionItem) => {
    setDraftText(version.content);
    setConfidence(version.confidenceScore);
    setSources(version.sources);
    setTemplateType(version.templateType);
    setHumanizationStatus(version.humanizationStatus);
    setActiveVersionId(version.id);
    setError(null);
  }, []);

  // Fetch all versions for an opportunity (newest first). Optionally load the
  // latest into the editor - used when switching opportunities / on restore.
  const loadVersions = useCallback(
    async (oppId: string, loadLatest: boolean) => {
      setVersionsLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("draft_versions")
        .select("*")
        .eq("opportunity_id", oppId)
        .order("version_number", { ascending: false });
      const mapped = ((data ?? []) as Tables<"draft_versions">[]).map(
        mapVersion,
      );
      setVersions(mapped);
      setVersionsLoading(false);
      const latest = mapped[0];
      if (loadLatest && latest) {
        loadVersion(latest);
      }
      return mapped;
    },
    [loadVersion],
  );

  // Initial load: opportunities + programs + restore the user's most recent draft.
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    (async () => {
      const [oppResult, programResult] = await Promise.all([
        supabase
          .from("opportunities")
          .select("id, name, category")
          .order("created_at", { ascending: false }),
        supabase.from("programs").select("id, name").order("name"),
      ]);
      if (!active) return;
      if (oppResult.error) {
        setError("Could not load opportunities.");
        setLoading(false);
        return;
      }
      const loaded = (oppResult.data ?? []) as OpportunityOption[];
      setOpportunities(loaded);
      setPrograms((programResult.data ?? []) as ProgramOption[]);

      // A deep link (?opportunity=) wins over restore: jump straight to that
      // opportunity's latest draft if it exists and belongs to this org.
      if (
        requestedOpportunityId &&
        loaded.some((o) => o.id === requestedOpportunityId)
      ) {
        if (active) setOpportunityId(requestedOpportunityId);
        setLoading(false);
        return;
      }

      // Restore the last draft this org worked on (BLUEPRINT §4.8). Setting the
      // opportunity id triggers the version-loading effect below, which loads
      // the latest version into the editor.
      const { data: lastVersion } = await supabase
        .from("draft_versions")
        .select("opportunity_id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (active && lastVersion?.opportunity_id) {
        setOpportunityId(lastVersion.opportunity_id as string);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [requestedOpportunityId]);

  // When the opportunity changes, load its history and latest draft, and reset
  // any budget-specific state from the previous opportunity.
  useEffect(() => {
    if (!opportunityId) {
      setVersions([]);
      setBudgetTable([]);
      setTotalRequested(null);
      return;
    }
    setBudgetTable([]);
    setTotalRequested(null);
    void loadVersions(opportunityId, true);
  }, [opportunityId, loadVersions]);

  const opportunityOptions = useMemo(
    () =>
      opportunities.map((o) => ({
        value: o.id,
        label: `${o.name} · ${humanizeEnum(o.category)}`,
      })),
    [opportunities],
  );

  const programOptions = useMemo(
    () => programs.map((p) => ({ value: p.id, label: p.name })),
    [programs],
  );

  const sections = useMemo(() => parseDraftSections(draftText), [draftText]);
  const readability = useMemo(() => computeReadabilityMetrics(draftText), [draftText]);

  function handleCopyToClipboard() {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(draftText)
      .then(() => {
        setCopiedToClipboard(true);
        setTimeout(() => setCopiedToClipboard(false), 2000);
      })
      .catch(() => undefined);
  }

  function handleDownloadTxt() {
    const blob = new Blob([draftText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "draft.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleDownloadPdf() {
    const win = window.open("", "_blank");
    if (!win) return;
    const escaped = draftText.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    win.document.write(
      `<!DOCTYPE html><html><head><title>Draft</title><style>body{font-family:Georgia,serif;line-height:1.7;max-width:820px;margin:48px auto;padding:0 24px;white-space:pre-wrap;font-size:12pt}@media print{body{margin:0}}</style></head><body>${escaped}</body></html>`,
    );
    win.document.close();
    win.print();
  }

  const canGenerate =
    Boolean(
      opportunityId &&
        templateType &&
        (templateType !== "budget_narrative" || programId),
    ) && editable;
  const hasDraft = draftText.trim() !== "" || confidence != null;

  const handleGenerate = useCallback(async () => {
    if (!opportunityId || !templateType) return;
    if (templateType === "budget_narrative" && !programId) return;
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setError(null);
    // Clear stale state so the prior draft, score, sources, and the Humanized
    // badge don't linger on screen while the new version generates.
    setDraftText("");
    setConfidence(null);
    setSources([]);
    setBudgetTable([]);
    setTotalRequested(null);
    setHumanizationStatus("not_humanized");
    setActiveVersionId(null);
    setRubric(null);
    setRubricInferred(false);
    setLogicModel(null);
    setDnaScore(null);

    try {
      if (templateType === "budget_narrative") {
        // Budget Narrative calls /api/ai/budget for structured line-item output
        // and a humanized prose narrative (AGENTS.md Agent 06).
        const res = await fetch("/api/ai/budget", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ opportunityId, programId }),
        });
        const payload = (await res.json()) as
          | BudgetApiResult
          | { error: string; code: string };

        if (!res.ok) {
          setError(
            "error" in payload
              ? (payload as { error: string }).error
              : "The budget could not be generated.",
          );
          return;
        }

        const budget = payload as BudgetApiResult;
        setDraftText(budget.budget_narrative);
        setConfidence(budget.confidence_score);
        setSources(budget.sources);
        setBudgetTable(budget.budget_table);
        setTotalRequested(budget.total_requested);
        setHumanizationStatus(
          budget.savedVersion?.humanizationStatus ?? "humanized",
        );
        setActiveVersionId(budget.savedVersion?.id ?? null);
        await loadVersions(opportunityId, false);
        const budgetCategory = opportunities.find((o) => o.id === opportunityId)?.category ?? "default";
        void runDNAScore(budget.budget_narrative, budgetCategory, "budget_narrative");
        return;
      }

      // All other template types use the generic draft endpoint.
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ opportunityId, templateType }),
      });
      const payload = (await res.json()) as
        | DraftResult
        | { error: string; code: string };

      if (!res.ok || !("content" in payload)) {
        setError(
          "error" in payload
            ? payload.error
            : "The draft could not be generated.",
        );
        return;
      }

      // The draft was already auto-saved to draft_versions by the API.
      setDraftText(payload.content);
      setConfidence(payload.confidenceScore);
      setSources(payload.sources);
      setBudgetTable([]);
      setTotalRequested(null);
      setHumanizationStatus(
        payload.savedVersion?.humanizationStatus ?? "not_humanized",
      );
      setActiveVersionId(payload.savedVersion?.id ?? null);
      setRubric(payload.rubric ?? null);
      setRubricInferred(payload.rubricInferred ?? false);
      setLogicModel(payload.logicModel ?? null);
      // Refresh the history panel to include the just-saved version.
      await loadVersions(opportunityId, false);
      const draftCategory = opportunities.find((o) => o.id === opportunityId)?.category ?? "default";
      void runDNAScore(payload.content, draftCategory, templateType ?? undefined);
    } catch {
      setError("Network error while generating. Please try again.");
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [opportunityId, templateType, programId, loadVersions, opportunities, runDNAScore]);

  // Second pass: rewrite the current draft for an authentic human voice
  // (anti-detection). The endpoint appends a new humanized version and returns
  // a confidence score that reflects the humanization (BLUEPRINT §4.8).
  const handleHumanize = useCallback(async () => {
    if (!opportunityId || !templateType || !draftText.trim()) return;
    if (humanizingRef.current) return;
    humanizingRef.current = true;
    setHumanizing(true);
    setError(null);

    try {
      const res = await fetch("/api/ai/humanize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId,
          templateType,
          content: draftText,
        }),
      });
      const payload = (await res.json()) as
        | HumanizeResult
        | { error: string; code: string };

      if (!res.ok || !("content" in payload)) {
        setError(
          "error" in payload
            ? payload.error
            : "The draft could not be humanized.",
        );
        return;
      }

      // Replace the editor content with the humanized draft. The humanizer
      // changes style, not content sources, so the confidence score is preserved
      // from the original generation — only setRescoreMessage can update it.
      setDraftText(payload.content);
      setSources(payload.sources);
      setHumanizationStatus(payload.humanizationStatus);
      setActiveVersionId(payload.savedVersion?.id ?? null);
      await loadVersions(opportunityId, false);
    } catch {
      setError("Network error while humanizing the draft. Please try again.");
    } finally {
      humanizingRef.current = false;
      setHumanizing(false);
    }
  }, [opportunityId, templateType, draftText, loadVersions]);

  // Re-score the current draft text client-side using the same algorithm as
  // the draft API. Called after manual edits to reflect filled-in gaps.
  function handleRescore() {
    if (!draftText.trim()) return;
    const kbCount = sources.filter((s) => s.kind === "knowledge_base").length;
    const provenCount = sources.filter((s) => s.kind === "proven_narrative").length;
    const needsInput = (draftText.match(/\[NEEDS INPUT/gi) ?? []).length;
    const newScore = computeRescoreConfidence(draftText, kbCount, provenCount);
    setConfidence(newScore);
    const msg =
      needsInput > 0
        ? `Score updated: ${newScore}/100 · ${needsInput} gap${needsInput !== 1 ? "s" : ""} remaining`
        : `Score updated: ${newScore}/100 · No gaps remaining`;
    setRescoreMessage(msg);
    setTimeout(() => setRescoreMessage(null), 4000);
  }

  // Revert to a previous version: append it as a new version (history is never
  // destroyed) and load it into the editor.
  async function handleRevert(version: DraftVersionItem) {
    if (!editable || !profile?.organization_id || !opportunityId) return;
    setReverting(true);
    setError(null);
    const supabase = createClient();
    const { data: created, error: revertError } = await supabase
      .from("draft_versions")
      .insert({
        organization_id: profile.organization_id,
        opportunity_id: opportunityId,
        template_type: version.templateType,
        content: version.content,
        confidence_score: version.confidenceScore,
        knowledge_sources: version.sources as unknown as Json,
        humanization_status: version.humanizationStatus,
        source: "reverted",
        created_by: profile.id,
      })
      .select("*")
      .single();

    setReverting(false);
    if (revertError || !created) {
      setError(revertError?.message ?? "Could not revert to that version.");
      return;
    }
    const mapped = await loadVersions(opportunityId, false);
    const fresh = mapped.find((v) => v.id === created.id);
    loadVersion(fresh ?? mapVersion(created as Tables<"draft_versions">));
  }

  async function handleSave() {
    if (!templateType || !opportunityId || !draftText.trim()) return;
    if (!profile?.organization_id) {
      setError("Your session could not be verified.");
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createClient();

    // A draft lives on an application record (SCHEMA: applications.draft_*).
    // Reuse the opportunity's most recent application, or create one.
    const { data: existing } = await supabase
      .from("applications")
      .select("id")
      .eq("opportunity_id", opportunityId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    const draftFields = {
      draft_content: draftText,
      draft_template_type: templateType,
      draft_confidence_score: confidence,
      draft_knowledge_sources: sources as unknown as Json,
      updated_at: new Date().toISOString(),
    };

    let applicationId = existing?.id as string | undefined;

    if (applicationId) {
      const { error: updateError } = await supabase
        .from("applications")
        .update(draftFields)
        .eq("id", applicationId);
      if (updateError) {
        setError(updateError.message);
        setSaving(false);
        return;
      }
    } else {
      const { data: created, error: insertError } = await supabase
        .from("applications")
        .insert({
          organization_id: profile.organization_id,
          opportunity_id: opportunityId,
          stage: "discovered",
          ...draftFields,
        })
        .select("id")
        .single();
      if (insertError || !created) {
        setError(insertError?.message ?? "Could not save the draft.");
        setSaving(false);
        return;
      }
      applicationId = created.id as string;
      // Record the application's creation in the pipeline timeline (§6).
      await supabase.from("pipeline_history").insert({
        organization_id: profile.organization_id,
        application_id: applicationId,
        from_stage: null,
        to_stage: "discovered",
        changed_by: profile.id,
        notes: "Created from Draft Generator.",
      });
    }

    // Link the loaded version to the application it was saved onto, so history
    // and the application record stay connected.
    if (activeVersionId) {
      await supabase
        .from("draft_versions")
        .update({ application_id: applicationId })
        .eq("id", activeVersionId);
    }

    router.push(`/draft-generator/${applicationId}`);
  }

  const belowThreshold =
    confidence != null && confidence < AI_CONFIDENCE_THRESHOLD;

  return (
    <div className="space-y-6" style={{ backgroundColor: "#0F1117" }}>
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-primary">
          Draft Generator
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Generate an application draft from your Knowledge Base. The AI never
          invents organizational facts - gaps are flagged for your input.
        </p>
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSpinner center label="Loading opportunities..." />
      ) : opportunities.length === 0 ? (
        <EmptyState
          icon={Wand2}
          title="No opportunities to draft for"
          description="Add a funding opportunity first, then return here to generate a tailored draft."
          action={
            <Button variant="secondary" onClick={() => router.push("/opportunities")}>
              Go to opportunities
            </Button>
          }
        />
      ) : (
        <>
          {!editable && (
            <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                Your role is read-only. You can view drafts but not generate or
                save them.
              </span>
            </div>
          )}

          <div
            className="bg-white rounded-2xl shadow-sm border border-border p-8 space-y-8"
            style={{
              backgroundColor: "#1A1D27",
              boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
              border: "1px solid #2E3345",
            }}
          >
            <div>
              <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                  1
                </span>
                Choose an opportunity
              </h2>
              <div className="max-w-xl">
                <Select
                  options={opportunityOptions}
                  value={opportunityId}
                  onChange={(e) => setOpportunityId(e.target.value)}
                  placeholder="Select an opportunity..."
                  disabled={!editable || generating}
                  aria-label="Opportunity"
                />
              </div>
            </div>

            <div>
              <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                  2
                </span>
                Choose a template
              </h2>
              <TemplateSelector
                value={templateType}
                onChange={setTemplateType}
                disabled={!editable || generating}
              />
            </div>

            {templateType === "budget_narrative" && (
              <div>
                <h2 className="text-base font-semibold text-slate-900 mb-4 flex items-center gap-2">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-white">
                    3
                  </span>
                  Choose a program
                </h2>
                <p className="mb-3 text-sm text-navy-500">
                  The budget will be scoped to this program&rsquo;s financial
                  data and your Knowledge Base budget justification entries.
                </p>
                <div className="max-w-xl space-y-2">
                  <Select
                    options={programOptions}
                    value={programId}
                    onChange={(e) => setProgramId(e.target.value)}
                    placeholder="Select a program..."
                    disabled={!editable || generating}
                    aria-label="Program"
                  />
                  {programs.length === 0 && !loading && (
                    <p className="text-sm text-navy-500">
                      No programs found. Add programs in organization settings
                      first.
                    </p>
                  )}
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={handleGenerate}
              disabled={!canGenerate || generating}
              className="w-full bg-gradient-to-r from-[#00B4D8] to-[#0077B6] hover:from-[#0093AC] hover:to-[#005F92] text-white py-4 rounded-xl font-bold text-base shadow-lg transition-all disabled:cursor-not-allowed disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <Sparkles className={`h-4 w-4 ${generating ? "animate-spin" : ""}`} aria-hidden />
              {generating
                ? "Generating..."
                : hasDraft
                  ? "Generate new version"
                  : "Generate draft"}
            </button>
          </div>

          {hasDraft && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:items-stretch">
              <div className="flex flex-col gap-4 lg:col-span-2">
                {belowThreshold && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900"
                  >
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                    <span>
                      This draft contains AI-generated content not verified
                      against your Knowledge Base. Review carefully before
                      submission.
                    </span>
                  </div>
                )}
                <Card
                  className="flex flex-1 flex-col"
                  title={<StepTitle step={3}>Review &amp; edit</StepTitle>}
                  description="Humanize rewrites the draft in an authentic human voice (no em dashes, no AI clichés, varied rhythm), grounded in your verified data."
                  actions={
                    editable ? (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const opp = opportunities.find((o) => o.id === opportunityId);
                            void runDNAScore(draftText, opp?.category ?? "default", templateType ?? undefined);
                          }}
                          disabled={!draftText.trim() || dnaScoring}
                          title="Score this draft with Grant DNA"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          <Dna className={`h-3.5 w-3.5 ${dnaScoring ? "animate-spin" : ""}`} aria-hidden />
                          {dnaScoring ? "Scoring..." : "Score Draft"}
                        </button>
                        <Button
                          variant="secondary"
                          onClick={handleHumanize}
                          isLoading={humanizing}
                          disabled={!draftText.trim() || generating || humanizing}
                          title="Rewrite this draft to read like a human wrote it"
                        >
                          <Wand2 className="h-4 w-4" aria-hidden />
                          {humanizing ? "Humanizing..." : "Humanize"}
                        </Button>
                      </div>
                    ) : undefined
                  }
                >
                  <DraftEditor
                    value={draftText}
                    onChange={setDraftText}
                    onSave={editable ? handleSave : undefined}
                    saving={saving}
                    readOnly={!editable}
                    label="Generated draft"
                  />

                  {readability && (
                    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-navy-100 pt-3">
                      <span
                        className={
                          "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium " +
                          (readability.gradeLevel >= 10 && readability.gradeLevel <= 12
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800")
                        }
                      >
                        Grade {readability.gradeLevel.toFixed(1)} reading level
                      </span>
                      <span
                        className={
                          "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium " +
                          (readability.passivePercent <= 15
                            ? "bg-green-100 text-green-800"
                            : "bg-yellow-100 text-yellow-800")
                        }
                      >
                        {readability.passivePercent.toFixed(0)}% passive voice
                      </span>
                      <span className="inline-flex items-center rounded-md bg-navy-100 px-2 py-1 text-xs font-medium text-navy-700">
                        {readability.wordCount.toLocaleString()} words
                      </span>
                      <span className="ml-auto text-xs text-navy-400">
                        Ideal: Grade 10–12, &lt;15% passive
                      </span>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-navy-100 pt-3">
                    <button
                      type="button"
                      onClick={handleCopyToClipboard}
                      disabled={!draftText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {copiedToClipboard ? (
                        <Check className="h-3.5 w-3.5 text-green-600" aria-hidden />
                      ) : (
                        <Clipboard className="h-3.5 w-3.5" aria-hidden />
                      )}
                      {copiedToClipboard ? "Copied!" : "Copy to clipboard"}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadTxt}
                      disabled={!draftText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      Download .txt
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      disabled={!draftText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-700 transition hover:bg-navy-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Download className="h-3.5 w-3.5" aria-hidden />
                      Download PDF
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Connect Gmail to enable"
                      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-navy-200 bg-white px-3 py-1.5 text-xs font-medium text-navy-400 opacity-50"
                    >
                      <MailIcon className="h-3.5 w-3.5" aria-hidden />
                      Email draft
                    </button>
                    <span className="text-xs text-navy-400">Connect Gmail to enable email</span>
                  </div>
                </Card>
              </div>

              <div className="space-y-6">
                <Card
                  title="Confidence"
                  actions={
                    <div className="flex items-center gap-2">
                      {editable && draftText.trim() && (
                        <button
                          type="button"
                          onClick={handleRescore}
                          title="Recalculate score from current draft text"
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs transition disabled:cursor-not-allowed disabled:opacity-60"
                          style={{ backgroundColor: "#f59e0b", color: "#000000", border: "1px solid #d97706", fontWeight: "500" }}
                        >
                          <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                          Rescore
                        </button>
                      )}
                      <Badge color={HUMANIZATION_BADGE[humanizationStatus].color}>
                        {HUMANIZATION_BADGE[humanizationStatus].label}
                      </Badge>
                    </div>
                  }
                >
                  {confidence != null ? (
                    <ConfidenceIndicator score={confidence} />
                  ) : (
                    <p className="text-sm text-navy-500">
                      No confidence score recorded for this draft.
                    </p>
                  )}
                  {rescoreMessage && (
                    <p className="mt-2 text-xs font-medium text-teal-600">
                      {rescoreMessage}
                    </p>
                  )}
                  {humanizationStatus === "humanized" && (
                    <p className="mt-2 text-xs text-navy-500">
                      This draft has been humanized. The score reflects how
                      well it&rsquo;s grounded in your data.
                    </p>
                  )}
                </Card>
                {(dnaScore !== null || dnaScoring) && (
                  dnaScore !== null ? (
                    <GrantDNACard
                      result={dnaScore}
                      scoring={dnaScoring}
                      onReScore={() => {
                        const opp = opportunities.find((o) => o.id === opportunityId);
                        void runDNAScore(draftText, opp?.category ?? "default", templateType ?? undefined);
                      }}
                    />
                  ) : (
                    <div
                      className="rounded-xl border border-border bg-white shadow-sm p-5"
                      style={{
                        backgroundColor: "#1A1D27",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
                        border: "1px solid #2E3345",
                      }}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <Dna className="h-4 w-4 animate-spin text-primary" aria-hidden />
                        <h3 className="text-base font-semibold text-text">Grant DNA Score</h3>
                      </div>
                      <div className="h-[220px] animate-pulse rounded-lg bg-white-raised" />
                    </div>
                  )
                )}
                <Card title="Sources used">
                  <KnowledgePreview sources={sources} />
                </Card>

                {sections.length > 0 && (
                  <Card title="Section scores">
                    <div className="space-y-1.5">
                      {sections.map((section, i) => {
                        const { score, gaps, words } = scoreSectionText(section.text);
                        const bg =
                          score >= 80
                            ? "bg-green-50 border border-green-200"
                            : score >= 60
                              ? "bg-yellow-50 border border-yellow-200"
                              : "bg-red-50 border border-red-200";
                        const scoreColor =
                          score >= 80
                            ? "text-green-700"
                            : score >= 60
                              ? "text-yellow-700"
                              : "text-red-700";
                        return (
                          <div key={i} className={"rounded-lg px-2.5 py-2 " + bg}>
                            <div className="flex items-center justify-between gap-2">
                              <span
                                className="min-w-0 truncate text-xs font-semibold text-navy-800"
                                title={section.name}
                              >
                                {section.name}
                              </span>
                              <div className="flex shrink-0 items-center gap-1.5">
                                <span className="text-xs text-navy-400">{words}w</span>
                                <span className={"text-xs font-bold " + scoreColor}>
                                  {score}/100
                                </span>
                              </div>
                            </div>
                            {score < 80 && (
                              <p className="mt-0.5 text-xs leading-snug text-navy-500">
                                {sectionSuggestion(score, gaps)}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </Card>
                )}

                <RubricPanel rubric={rubric} rubricInferred={rubricInferred} />
                {logicModel && (
                  <Card
                    title="Program logic model"
                    description="The inputs → impact backbone the AI used to ground this draft's program design. Sourced from the Intelligence Library when a template matches, otherwise generated for this opportunity."
                  >
                    <LogicModelView model={logicModel} />
                  </Card>
                )}
                {budgetTable.length > 0 && (
                  <Card title="Budget line items">
                    <div className="space-y-2">
                      {budgetTable.map((item, i) => (
                        <div
                          key={i}
                          className="flex items-start justify-between gap-3 border-b border-navy-100 pb-2 last:border-0 last:pb-0"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium capitalize text-navy-900">
                              {item.category}
                            </p>
                            <p className="mt-0.5 text-xs leading-snug text-navy-500">
                              {item.justification}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono text-sm text-navy-900">
                              {item.amount != null
                                ? formatCurrency(item.amount)
                                : "[NEEDS INPUT]"}
                            </p>
                            {item.percentage != null && (
                              <p className="text-xs text-navy-500">
                                {item.percentage.toFixed(1)}%
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                      {totalRequested != null && (
                        <div className="mt-1 flex items-center justify-between border-t-2 border-navy-200 pt-2">
                          <p className="text-sm font-semibold text-navy-900">
                            Total requested
                          </p>
                          <p className="font-mono text-sm font-semibold text-navy-900">
                            {formatCurrency(totalRequested)}
                          </p>
                        </div>
                      )}
                    </div>
                  </Card>
                )}
              </div>
            </div>
          )}

          {opportunityId && (
            <Card title="Version history">
              <DraftsHistoryPanel
                versions={versions}
                activeVersionId={activeVersionId}
                loading={versionsLoading}
                onView={loadVersion}
                onRevert={editable ? handleRevert : undefined}
                reverting={reverting}
              />
            </Card>
          )}
        </>
      )}
    </div>
  );
}
