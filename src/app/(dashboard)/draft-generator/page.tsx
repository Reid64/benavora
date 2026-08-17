"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Check, Clipboard, Dna, Download, Mail as MailIcon, RefreshCw, Sparkles, Wand2 } from "lucide-react";

import {
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
  Select,
} from "@/components/ui";
import { TemplateSelector } from "@/components/draft-generator/TemplateSelector";
import { DraftEditor } from "@/components/draft-generator/DraftEditor";
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

type DraftStats = {
  totalDrafts: number;
  aiPending: number;
  draftsThisMonth: number;
  avgConfidence: number | null;
};

type RecentDraftRow = {
  id: string;
  opportunityId: string;
  opportunityName: string;
  templateType: DraftTemplateType;
  confidenceScore: number | null;
  source: string;
  createdAt: string;
};

/** Recent-drafts confidence pill colors, by score band. */
function tableConfidenceBadge(score: number): { bg: string; color: string } {
  if (score >= 80) return { bg: "rgba(52,211,153,0.15)", color: "#34D399" };
  if (score >= 60) return { bg: "rgba(251,191,36,0.15)", color: "#FCD34D" };
  return { bg: "rgba(248,113,113,0.15)", color: "#F87171" };
}

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

/** Score-band color for the confidence number/bar — the page's one legitimate
 * use of semantic red/amber/green, reserved for this real status only. */
function confidenceBarColor(score: number): string {
  if (score >= 80) return "#059669";
  if (score >= 50) return "#D97706";
  return "#DC2626";
}

/** Score-band interpretation text under the confidence bar. */
function confidenceStatusText(score: number): string {
  if (score >= 80) return "High confidence — grounded in verified Knowledge Base content and proven narratives.";
  if (score >= 60) return "Review recommended — some AI-inferred content beyond your Knowledge Base.";
  return "Low confidence — verify carefully against your Knowledge Base before submitting.";
}

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

  const [stats, setStats] = useState<DraftStats | null>(null);
  const [recentDrafts, setRecentDrafts] = useState<RecentDraftRow[]>([]);
  const [recentDraftsLoading, setRecentDraftsLoading] = useState(true);

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

  // Header stats row + recent drafts table — org-wide, independent of the
  // opportunity currently selected in the generator below.
  const loadStatsAndRecent = useCallback(async () => {
    setRecentDraftsLoading(true);
    const supabase = createClient();
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

    const [totalRes, monthRes, pendingRes, confidenceRes, recentRes] = await Promise.all([
      supabase.from("draft_versions").select("id", { count: "exact", head: true }),
      supabase
        .from("draft_versions")
        .select("id", { count: "exact", head: true })
        .gte("created_at", startOfMonth),
      supabase
        .from("applications")
        .select("id", { count: "exact", head: true })
        .eq("auto_generated", true)
        .eq("pending_review", true),
      supabase.from("draft_versions").select("confidence_score"),
      supabase
        .from("draft_versions")
        .select("id, opportunity_id, template_type, confidence_score, source, created_at, opportunities(name)")
        .order("created_at", { ascending: false })
        .limit(8),
    ]);

    const confidenceScores = (
      (confidenceRes.data ?? []) as Array<{ confidence_score: number | null }>
    )
      .map((row) => row.confidence_score)
      .filter((score): score is number => score != null);
    const avgConfidence =
      confidenceScores.length > 0
        ? Math.round(confidenceScores.reduce((sum, s) => sum + s, 0) / confidenceScores.length)
        : null;

    setStats({
      totalDrafts: totalRes.count ?? 0,
      draftsThisMonth: monthRes.count ?? 0,
      aiPending: pendingRes.count ?? 0,
      avgConfidence,
    });

    const recent = (
      (recentRes.data ?? []) as unknown as Array<{
        id: string;
        opportunity_id: string;
        template_type: DraftTemplateType;
        confidence_score: number | null;
        source: string;
        created_at: string;
        opportunities: { name: string } | null;
      }>
    ).map((row) => ({
      id: row.id,
      opportunityId: row.opportunity_id,
      opportunityName: row.opportunities?.name ?? "Unknown opportunity",
      templateType: row.template_type,
      confidenceScore: row.confidence_score,
      source: row.source,
      createdAt: row.created_at,
    }));
    setRecentDrafts(recent);
    setRecentDraftsLoading(false);
  }, []);

  useEffect(() => {
    void loadStatsAndRecent();
  }, [loadStatsAndRecent]);

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
        void loadStatsAndRecent();
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
      void loadStatsAndRecent();
      const draftCategory = opportunities.find((o) => o.id === opportunityId)?.category ?? "default";
      void runDNAScore(payload.content, draftCategory, templateType ?? undefined);
    } catch {
      setError("Network error while generating. Please try again.");
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [opportunityId, templateType, programId, loadVersions, opportunities, runDNAScore, loadStatsAndRecent]);

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

  const indigoCardStyle = {
    backgroundColor: "#FFFFFF",
    borderRadius: "14px",
    padding: "20px",
    border: "1px solid #E2E8F0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  };
  // Wizard rail step (1 Select Opportunity, 2 Customize, 3 Generate, 4 Review
  // & Export) derived from real state - there is no separate wizard-step
  // field, this mirrors what the form is actually doing right now.
  const activeStep = generating ? 3 : hasDraft ? 4 : opportunityId ? 2 : 1;
  const stepStatus = (n: number): "done" | "active" | "pending" =>
    n < activeStep ? "done" : n === activeStep ? "active" : "pending";
  const statNumberStyle = {
    fontSize: "32px",
    fontWeight: 800 as const,
    color: "#0F172A",
    lineHeight: 1,
  };
  const statLabelStyle = {
    fontSize: "11px",
    fontWeight: 700 as const,
    color: "#64748B",
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    marginTop: "8px",
  };
  const statCardStyle = {
    flex: "1",
    backgroundColor: "#FFFFFF",
    borderRadius: "12px",
    padding: "18px 20px",
    border: "1px solid #E2E8F0",
    borderLeft: "3px solid #1D4ED8",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  };

  return (
    <div className="space-y-6" style={{ backgroundColor: "#71717A", color: "#FFFFFF", minHeight: "100vh", padding: "24px", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
      {/* Cobalt/teal/violet all measure under 2:1 contrast against #71717A (verified via
          WCAG relative-luminance) - none of the 3 accent colors are usable as text/borders
          directly on this page background. White is the only accent that clears AA (4.83:1)
          here, so page-level chrome (title, border accent) uses white; the brand accents are
          reserved for surfaces with a white/light backing (cards, the wizard rail fill). */}
      <div style={{ borderLeft: "4px solid #FFFFFF", paddingLeft: "16px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 800, color: "#FFFFFF", marginBottom: "4px" }}>
          Draft Generator
        </h1>
        <p style={{ fontSize: "14px", color: "#FFFFFF", marginBottom: "24px" }}>
          Generate an application draft from your Knowledge Base. The AI never
          invents organizational facts - gaps are flagged for your input.
        </p>
      </div>

      <div className="flex flex-col gap-4 sm:flex-row">
        <div style={statCardStyle}>
          <p style={statNumberStyle}>{stats ? stats.totalDrafts : "—"}</p>
          <p style={statLabelStyle}>Total Drafts</p>
        </div>
        <div style={statCardStyle}>
          <div className="flex items-center justify-between">
            <p style={statNumberStyle}>{stats ? stats.aiPending : "—"}</p>
            <span
              title="Royal-violet highlight - deliberately used once here to mark AI-touched stats, not as a status color"
              style={{
                backgroundColor: "rgba(91,33,182,0.12)",
                color: "#5B21B6",
                fontSize: "10px",
                fontWeight: 700,
                borderRadius: "999px",
                padding: "2px 8px",
              }}
            >
              AI
            </span>
          </div>
          <p style={statLabelStyle}>AI Drafts Pending</p>
        </div>
        <div style={statCardStyle}>
          <p style={statNumberStyle}>{stats ? stats.draftsThisMonth : "—"}</p>
          <p style={statLabelStyle}>Drafts This Month</p>
        </div>
        <div style={statCardStyle}>
          <p style={statNumberStyle}>
            {stats && stats.avgConfidence != null ? `${stats.avgConfidence}/100` : "—"}
          </p>
          <p style={statLabelStyle}>Avg Confidence</p>
        </div>
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

          <div className="flex flex-col gap-6 lg:flex-row">
            <div
              style={{
                width: "200px",
                flexShrink: 0,
                alignSelf: "flex-start",
                position: "sticky",
                top: "24px",
                backgroundColor: "#1D4ED8",
                borderRadius: "14px",
                padding: "20px",
                border: "1px solid rgba(255,255,255,0.15)",
                boxShadow: "0 4px 16px rgba(29,78,216,0.4)",
              }}
            >
              <p
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.15em",
                  color: "#FFFFFF",
                  textTransform: "uppercase",
                  marginBottom: "20px",
                  display: "block",
                }}
              >
                Grant Draft Wizard
              </p>
              {[
                { n: 1, label: "Select Opportunity" },
                { n: 2, label: "Customize" },
                { n: 3, label: "Generate" },
                { n: 4, label: "Review & Export" },
              ].map(({ n, label }) => {
                const status = stepStatus(n);
                const rowStyle =
                  status === "done"
                    ? {
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                        padding: "12px",
                        borderRadius: "8px",
                        backgroundColor: "rgba(255,255,255,0.12)",
                        marginBottom: "8px",
                      }
                    : status === "active"
                      ? {
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "12px",
                          borderRadius: "8px",
                          backgroundColor: "#FFFFFF",
                          boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
                          marginBottom: "8px",
                        }
                      : {
                          display: "flex",
                          alignItems: "center",
                          gap: "12px",
                          padding: "12px",
                          borderRadius: "8px",
                          backgroundColor: "rgba(255,255,255,0.1)",
                          marginBottom: "8px",
                        };
                // Non-active step dots (done + pending) use the teal secondary accent;
                // only the active step keeps the primary cobalt dot.
                const dotStyle =
                  status === "done"
                    ? { width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#0D9488", flexShrink: 0 }
                    : status === "active"
                      ? { width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "#1D4ED8", flexShrink: 0 }
                      : { width: "10px", height: "10px", borderRadius: "50%", backgroundColor: "rgba(13,148,136,0.5)", flexShrink: 0 };
                const textStyle =
                  status === "done"
                    ? { fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.8)" }
                    : status === "active"
                      ? { fontSize: "13px", fontWeight: 700, color: "#1E3A8A" }
                      : { fontSize: "13px", fontWeight: 500, color: "rgba(255,255,255,0.6)" };
                return (
                  <div key={n} style={rowStyle}>
                    <span style={dotStyle} />
                    <span style={textStyle}>{label}</span>
                  </div>
                );
              })}
              <div style={{borderTop:'1px solid rgba(255,255,255,0.25)',marginTop:'16px',paddingTop:'16px'}}>
                <p style={{fontSize:'10px',fontWeight:700,letterSpacing:'0.12em',color:'rgba(255,255,255,0.65)',textTransform:'uppercase',marginBottom:'12px'}}>INTELLIGENCE TIPS</p>
                <div style={{fontSize:'12px',color:'rgba(255,255,255,0.85)',lineHeight:'1.6',marginBottom:'10px',paddingLeft:'8px',borderLeft:'2px solid rgba(255,255,255,0.5)'}}>
                  Visit Intelligence Library to import winning grant narratives that boost your confidence score
                </div>
                <div style={{fontSize:'12px',color:'rgba(255,255,255,0.85)',lineHeight:'1.6',marginBottom:'10px',paddingLeft:'8px',borderLeft:'2px solid rgba(255,255,255,0.5)'}}>
                  Narratives matched to your NTEE category increase AI accuracy by up to 40%
                </div>
                <div style={{fontSize:'12px',color:'rgba(255,255,255,0.85)',lineHeight:'1.6',marginBottom:'10px',paddingLeft:'8px',borderLeft:'2px solid rgba(255,255,255,0.5)'}}>
                  Humanize your draft before submitting — scores above 80 pass most AI detection filters
                </div>
                <div style={{fontSize:'12px',color:'rgba(255,255,255,0.85)',lineHeight:'1.6',paddingLeft:'8px',borderLeft:'2px solid rgba(255,255,255,0.5)'}}>
                  Complete your Knowledge Base org profile to eliminate [NEEDS INPUT] gaps in generated drafts
                </div>
              </div>
            </div>

            <div style={{ flex: "1", display: "flex", flexDirection: "column", minWidth: 0 }}>
              {!generating && (
                <>
                  <div style={{ ...indigoCardStyle, marginBottom: "12px" }}>
                    <p style={{ fontSize: "11px", fontWeight: 700, color: "#1D4ED8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>
                      Choose an opportunity
                    </p>
                    <div className="max-w-xl">
                      <Select
                        options={opportunityOptions}
                        value={opportunityId}
                        onChange={(e) => setOpportunityId(e.target.value)}
                        placeholder="Select an opportunity..."
                        disabled={!editable || generating}
                        aria-label="Opportunity"
                        style={{width:'100%',padding:'11px 14px',borderRadius:'10px',border:'1.5px solid #E2E8F0',fontSize:'14px',color:'#0F172A',backgroundColor:'#F8FAFC',outline:'none',cursor:'pointer'}}
                      />
                    </div>
                  </div>

                  <div style={{ ...indigoCardStyle, marginBottom: "12px" }}>
                    <p style={{ fontSize: "11px", fontWeight: 700, color: "#1D4ED8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "14px" }}>
                      Choose a template
                    </p>
                    <TemplateSelector
                      value={templateType}
                      onChange={setTemplateType}
                      disabled={!editable || generating}
                    />

                    {templateType === "budget_narrative" && (
                      <div className="mt-6">
                        <p style={{ fontSize: "11px", fontWeight: 700, color: "#1D4ED8", textTransform: "uppercase", letterSpacing: "0.1em", marginBottom: "10px" }}>
                          Choose a program
                        </p>
                        <p className="mb-3 text-sm" style={{ color: "#64748B" }}>
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
                            style={{
                              width: "100%",
                              padding: "11px 14px",
                              borderRadius: "10px",
                              border: "1.5px solid #E2E8F0",
                              fontSize: "14px",
                              color: "#0F172A",
                              backgroundColor: "#F8FAFC",
                              outline: "none",
                            }}
                          />
                          {programs.length === 0 && !loading && (
                            <p className="text-sm" style={{ color: "#64748B" }}>
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
                      style={{
                        width: "100%",
                        backgroundColor: "#22D3EE",
                        color: "#0F172A",
                        border: "none",
                        borderRadius: "12px",
                        padding: "14px",
                        fontSize: "15px",
                        fontWeight: 700,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        marginTop: "4px",
                        boxShadow: "0 6px 20px rgba(34,211,238,0.5)",
                        letterSpacing: "0.02em",
                      }}
                      className="disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Sparkles className="h-4 w-4" aria-hidden />
                      {hasDraft ? "Generate new version" : "Generate draft"}
                    </button>
                  </div>
                </>
              )}

              {generating && (
                <div className="text-center" style={indigoCardStyle}>
                  <div
                    style={{
                      width: "80px",
                      height: "80px",
                      borderRadius: "50%",
                      background: "conic-gradient(#1D4ED8,#3B82F6,#1D4ED8)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 24px",
                    }}
                  >
                    <div
                      style={{
                        width: "64px",
                        height: "64px",
                        borderRadius: "50%",
                        backgroundColor: "#FFFFFF",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Sparkles className="h-6 w-6 animate-pulse" style={{ color: "#1D4ED8" }} aria-hidden />
                    </div>
                  </div>
                  <p style={{ fontSize: "15px", fontWeight: 700, color: "#0F172A" }}>Generating your draft…</p>
                  <p style={{ fontSize: "13px", color: "#64748B", marginTop: "6px" }}>
                    Drawing on your Knowledge Base to write a grounded{" "}
                    {templateType ? humanizeEnum(templateType) : "draft"}. This can take a couple of minutes.
                  </p>
                </div>
              )}

              {hasDraft && !generating && (
          <div className="flex flex-col gap-6 xl:flex-row" style={{ minHeight: "600px" }}>
              <div className="flex flex-1 flex-col gap-4" style={{ minWidth: 0 }}>
                <div
                  style={{
                    backgroundColor: "#FFFFFF",
                    borderRadius: "14px",
                    padding: "24px",
                    border: "1px solid #E2E8F0",
                    flex: "1",
                    display: "flex",
                    flexDirection: "column",
                    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      flexWrap: "wrap",
                      gap: "12px",
                      marginBottom: "12px",
                    }}
                  >
                    <div className="flex items-center gap-2.5">
                      <span style={{ fontSize: "11px", fontWeight: 700, color: "#1D4ED8", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                        Review &amp; edit
                      </span>
                      {confidence != null && (
                        <span
                          style={{
                            fontSize: "13px",
                            fontWeight: 800,
                            color: confidenceBarColor(confidence),
                            backgroundColor: "#F8FAFC",
                            border: `1px solid ${confidenceBarColor(confidence)}`,
                            borderRadius: "6px",
                            padding: "2px 10px",
                          }}
                        >
                          {Math.round(confidence)}/100
                        </span>
                      )}
                      {humanizationStatus === "humanized" && (
                        <span
                          style={{
                            backgroundColor: "rgba(5,150,105,0.1)",
                            color: "#059669",
                            border: "1px solid rgba(5,150,105,0.3)",
                            borderRadius: "6px",
                            padding: "3px 10px",
                            fontSize: "11px",
                            fontWeight: 700,
                          }}
                        >
                          Humanized
                        </span>
                      )}
                    </div>
                    {editable && (
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            const opp = opportunities.find((o) => o.id === opportunityId);
                            void runDNAScore(draftText, opp?.category ?? "default", templateType ?? undefined);
                          }}
                          disabled={!draftText.trim() || dnaScoring}
                          title="Score this draft with Grant DNA"
                          className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ backgroundColor: "#F8FAFC", border: "1px solid #0D9488", color: "#475569", borderRadius: "8px", padding: "7px 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                        >
                          <Dna className={`h-3.5 w-3.5 ${dnaScoring ? "animate-spin" : ""}`} style={{ color: "#0D9488" }} aria-hidden />
                          {dnaScoring ? "Scoring..." : "Score Draft"}
                        </button>
                        <button
                          type="button"
                          onClick={handleHumanize}
                          disabled={!draftText.trim() || generating || humanizing}
                          title="Rewrite this draft to read like a human wrote it"
                          className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                          style={{ backgroundColor: "#F8FAFC", border: "1px solid #0D9488", color: "#475569", borderRadius: "8px", padding: "7px 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                        >
                          <Wand2 className="h-4 w-4" style={{ color: "#0D9488" }} aria-hidden />
                          {humanizing ? "Humanizing..." : "Humanize"}
                        </button>
                        {draftText.trim() && (
                          <button
                            type="button"
                            onClick={handleRescore}
                            title="Recalculate score from current draft text"
                            className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ backgroundColor: "#F8FAFC", border: "1px solid #0D9488", color: "#475569", borderRadius: "8px", padding: "7px 14px", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}
                          >
                            <RefreshCw className="h-3.5 w-3.5" style={{ color: "#0D9488" }} aria-hidden />
                            Rescore
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  {confidence != null ? (
                    <div style={{ marginBottom: "16px" }}>
                      <div style={{ backgroundColor: "#E2E8F0", borderRadius: "4px", height: "6px" }}>
                        <div
                          style={{
                            width: `${Math.max(0, Math.min(100, Math.round(confidence)))}%`,
                            height: "100%",
                            borderRadius: "4px",
                            backgroundColor: confidenceBarColor(confidence),
                          }}
                        />
                      </div>
                      <p style={{ fontSize: "12px", color: "#64748B", marginTop: "6px" }}>
                        {confidenceStatusText(confidence)}
                        {belowThreshold && " This draft falls below your review threshold."}
                      </p>
                      {rescoreMessage && (
                        <p style={{ fontSize: "12px", color: "#1D4ED8", marginTop: "4px", fontWeight: 600 }}>
                          {rescoreMessage}
                        </p>
                      )}
                    </div>
                  ) : (
                    <p style={{ fontSize: "12px", color: "#94A3B8", marginBottom: "16px" }}>
                      No confidence score recorded for this draft.
                    </p>
                  )}

                  <p style={{ fontSize: "13px", color: "#64748B", marginBottom: "16px" }}>
                    Humanize rewrites the draft in an authentic human voice (no em dashes, no AI clichés, varied rhythm), grounded in your verified data.
                  </p>

                  <div style={{ flex: "1", minHeight: "400px" }}>
                    <DraftEditor
                      value={draftText}
                      onChange={setDraftText}
                      onSave={editable ? handleSave : undefined}
                      saving={saving}
                      readOnly={!editable}
                      label="Generated draft"
                    />
                  </div>

                  {readability && (
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", padding: "10px 0 0", borderTop: "1px solid #E2E8F0", marginTop: "12px" }}>
                      <span style={{ fontSize: "12px", color: "#64748B", display: "flex", alignItems: "center", gap: "4px" }}>
                        Grade {readability.gradeLevel.toFixed(1)} reading level
                      </span>
                      <span style={{ fontSize: "12px", color: "#64748B", display: "flex", alignItems: "center", gap: "4px" }}>
                        {readability.passivePercent.toFixed(0)}% passive voice
                      </span>
                      <span style={{ fontSize: "12px", color: "#64748B", display: "flex", alignItems: "center", gap: "4px" }}>
                        {readability.wordCount.toLocaleString()} words
                      </span>
                      <span style={{ fontSize: "12px", color: "#64748B", marginLeft: "auto" }}>
                        Ideal: Grade 10–12, &lt;15% passive
                      </span>
                    </div>
                  )}

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: "#E2E8F0" }}>
                    <button
                      type="button"
                      onClick={handleCopyToClipboard}
                      disabled={!draftText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: "#F8FAFC", border: "1px solid #0D9488", color: "#475569" }}
                    >
                      {copiedToClipboard ? (
                        <Check className="h-3.5 w-3.5 text-green-500" aria-hidden />
                      ) : (
                        <Clipboard className="h-3.5 w-3.5" style={{ color: "#0D9488" }} aria-hidden />
                      )}
                      {copiedToClipboard ? "Copied!" : "Copy to clipboard"}
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadTxt}
                      disabled={!draftText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: "#F8FAFC", border: "1px solid #0D9488", color: "#475569" }}
                    >
                      <Download className="h-3.5 w-3.5" style={{ color: "#0D9488" }} aria-hidden />
                      Download .txt
                    </button>
                    <button
                      type="button"
                      onClick={handleDownloadPdf}
                      disabled={!draftText.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50"
                      style={{ backgroundColor: "#F8FAFC", border: "1px solid #0D9488", color: "#475569" }}
                    >
                      <Download className="h-3.5 w-3.5" style={{ color: "#0D9488" }} aria-hidden />
                      Download PDF
                    </button>
                    <button
                      type="button"
                      disabled
                      title="Connect Gmail to enable"
                      className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium opacity-50"
                      style={{ backgroundColor: "#F8FAFC", border: "1px solid #E2E8F0", color: "#94A3B8" }}
                    >
                      <MailIcon className="h-3.5 w-3.5" aria-hidden />
                      Email draft
                    </button>
                    <span className="text-xs" style={{ color: "#94A3B8" }}>Connect Gmail to enable email</span>
                  </div>
                </div>
              </div>

              <div className="flex flex-col gap-6" style={{ width: "240px", flexShrink: 0 }}>
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
                      className="rounded-xl border border-border shadow-sm p-5"
                      style={{
                        backgroundColor: "#FFFFFF",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
                        border: "1px solid #E2E8F0",
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
                                <span className="text-xs" style={{ color: "#94A3B8" }}>{words}w</span>
                                <span className={"text-xs font-bold " + scoreColor}>
                                  {score}/100
                                </span>
                              </div>
                            </div>
                            {score < 80 && (
                              <p className="mt-0.5 text-xs leading-snug" style={{ color: "#64748B" }}>
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
                          className="flex items-start justify-between gap-3 border-b pb-2 last:border-0 last:pb-0"
                          style={{ borderColor: "#E2E8F0" }}
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium capitalize" style={{ color: "#0F172A" }}>
                              {item.category}
                            </p>
                            <p className="mt-0.5 text-xs leading-snug" style={{ color: "#64748B" }}>
                              {item.justification}
                            </p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="font-mono text-sm" style={{ color: "#0F172A" }}>
                              {item.amount != null
                                ? formatCurrency(item.amount)
                                : "[NEEDS INPUT]"}
                            </p>
                            {item.percentage != null && (
                              <p className="text-xs" style={{ color: "#64748B" }}>
                                {item.percentage.toFixed(1)}%
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                      {totalRequested != null && (
                        <div className="mt-1 flex items-center justify-between border-t-2 border-navy-200 pt-2">
                          <p className="text-sm font-semibold" style={{ color: "#0F172A" }}>
                            Total requested
                          </p>
                          <p className="font-mono text-sm font-semibold" style={{ color: "#0F172A" }}>
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
            </div>
          </div>

          <div
            style={{
              marginTop: "16px",
              backgroundColor: "#FFFFFF",
              borderRadius: "14px",
              overflow: "hidden",
              border: "1px solid #E2E8F0",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <div
              role="row"
              style={{
                backgroundColor: "#F8FAFC",
                padding: "14px 20px",
                display: "flex",
                gap: "24px",
                borderBottom: "1px solid #E2E8F0",
              }}
            >
              <span style={{ flex: 2, fontSize: "11px", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Opportunity
              </span>
              <span style={{ flex: 1, fontSize: "11px", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Template
              </span>
              <span style={{ flex: "0 0 90px", fontSize: "11px", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Confidence
              </span>
              <span style={{ flex: "0 0 110px", fontSize: "11px", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Source
              </span>
              <span style={{ flex: "0 0 90px", fontSize: "11px", fontWeight: 700, color: "#94A3B8", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Created
              </span>
              <span style={{ flex: "0 0 50px" }} />
            </div>
            {recentDraftsLoading ? (
              <div className="p-5 text-sm" style={{ color: "#94A3B8" }}>Loading recent drafts…</div>
            ) : recentDrafts.length === 0 ? (
              <div className="p-5 text-sm" style={{ color: "#94A3B8" }}>
                No drafts generated yet. Generate one above to see it here.
              </div>
            ) : (
              recentDrafts.map((draft) => (
                <div
                  key={draft.id}
                  role="row"
                  style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: "16px", borderBottom: "1px solid #F1F5F9" }}
                >
                  <span className="truncate" style={{ flex: 2, fontSize: "13px", fontWeight: 600, color: "#0F172A" }}>
                    {draft.opportunityName}
                  </span>
                  <span style={{ flex: 1, fontSize: "12px", color: "#64748B" }}>
                    {humanizeEnum(draft.templateType)}
                  </span>
                  <span style={{ flex: "0 0 90px" }}>
                    {draft.confidenceScore != null ? (
                      <span
                        style={{
                          backgroundColor: tableConfidenceBadge(draft.confidenceScore).bg,
                          color: tableConfidenceBadge(draft.confidenceScore).color,
                          borderRadius: "6px",
                          padding: "2px 8px",
                          fontSize: "12px",
                          fontWeight: 700,
                        }}
                      >
                        {draft.confidenceScore}/100
                      </span>
                    ) : (
                      <span style={{ color: "#94A3B8", fontSize: "12px" }}>—</span>
                    )}
                  </span>
                  <span style={{ flex: "0 0 110px" }}>
                    {draft.source === "generated" ? (
                      <span
                        title="Royal-violet highlight - the 2nd deliberate use, marking AI-generated provenance"
                        style={{
                          backgroundColor: "rgba(91,33,182,0.12)",
                          color: "#5B21B6",
                          borderRadius: "6px",
                          padding: "2px 8px",
                          fontSize: "11px",
                          fontWeight: 600,
                        }}
                      >
                        AI Generated
                      </span>
                    ) : draft.source === "humanized" ? (
                      <span
                        style={{
                          backgroundColor: "rgba(5,150,105,0.1)",
                          color: "#059669",
                          borderRadius: "6px",
                          padding: "2px 8px",
                          fontSize: "11px",
                          fontWeight: 600,
                        }}
                      >
                        Humanized
                      </span>
                    ) : (
                      <span style={{ fontSize: "11px", color: "#94A3B8" }}>{humanizeEnum(draft.source)}</span>
                    )}
                  </span>
                  <span style={{ flex: "0 0 90px", fontSize: "12px", color: "#94A3B8" }}>
                    {new Date(draft.createdAt).toLocaleDateString()}
                  </span>
                  <span style={{ flex: "0 0 50px" }}>
                    <button
                      type="button"
                      onClick={() => setOpportunityId(draft.opportunityId)}
                      style={{ color: "#1D4ED8", fontSize: "13px", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}
                    >
                      Open
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>

          {opportunityId && (
            <div style={{ marginTop: "12px", backgroundColor: "#FFFFFF", borderRadius: "14px", padding: "20px", border: "1px solid #E2E8F0" }}>
              <p style={{ fontSize: "13px", fontWeight: 700, color: "#0F172A", marginBottom: "14px" }}>
                Version history
              </p>
              <DraftsHistoryPanel
                versions={versions}
                activeVersionId={activeVersionId}
                loading={versionsLoading}
                onView={loadVersion}
                onRevert={editable ? handleRevert : undefined}
                reverting={reverting}
              />
            </div>
          )}
        </>
      )}
    </div>
  );
}
