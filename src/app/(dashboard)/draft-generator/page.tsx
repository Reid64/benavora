"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  Clipboard,
  Dna,
  Download,
  Mail as MailIcon,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
  Wand2,
} from "lucide-react";

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

/** Real per-opportunity match score, from the same computeMatchFeed() ranking
 * that powers /intelligence/match-feed - never a fabricated number. */
type MatchScoreEntry = { combinedScore: number; probabilityBlended: boolean };

type WizardStep = 1 | 2 | 3 | 4;
const WIZARD_STEPS: { n: WizardStep; label: string }[] = [
  { n: 1, label: "Select Opportunity" },
  { n: 2, label: "Customize" },
  { n: 3, label: "Generate" },
  { n: 4, label: "Review & Export" },
];

/** Shown alongside step content (not just tucked at the rail's bottom) on
 * the three sparser steps, so the available space is used purposefully. */
const INTELLIGENCE_TIPS = [
  "Visit Intelligence Library to import winning grant narratives that boost your confidence score.",
  "Narratives matched to your NTEE category increase AI accuracy by up to 40%.",
  "Humanize your draft before submitting — scores above 80 pass most AI detection filters.",
  "Complete your Knowledge Base org profile to eliminate [NEEDS INPUT] gaps in generated drafts.",
];

// --- Brand palette (gold/navy/champagne system, rebalanced 2026-08-17).
// The page's main background is champagne (light) with a navy wizard rail
// (the one deliberately dark surface). Real status colors (confidence
// bands, errors) are the only colors kept outside this system. ---
const CHAMPAGNE = "#E8D7A8";
const NAVY = "#101B2D";
const GOLD = "#C9A34E";
const NEAR_BLACK = "#0B0B0B";
const CARD_BG = "#FAFAF8";
const CARD_BORDER = "#E5E0D5";
const TEXT_PRIMARY = "#0B0B0B";
const TEXT_SECONDARY = "#6B6558";
/** Darkened gold for text/icons on light (ivory/white/champagne) surfaces -
 * the raw #C9A34E gold fails contrast on light backgrounds and is reserved
 * for dark surfaces (the navy rail) and solid button fills. */
const GOLD_TEXT_ON_LIGHT = "#8B6B2E";
const GOLD_TINT_BG = "rgba(201,163,78,0.14)";
/** Text sitting directly on the champagne page background (header, byline)
 * — real navy, never white/light, since the page background is now light. */
const TEXT_ON_CHAMPAGNE = NAVY;
const TEXT_ON_CHAMPAGNE_MUTED = "rgba(16,27,45,0.68)";
/** Text on the wizard rail's own navy surface — that one panel stays dark by
 * design, so it keeps light text. Not used anywhere on the champagne page
 * background itself. */
const TEXT_ON_DARK = "#F8F5EE";
const TEXT_ON_DARK_MUTED = "rgba(248,245,238,0.62)";

/** Recent-drafts confidence pill colors, by score band - real status colors, unaffected by the brand palette. */
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

/** Score-band color for the confidence number/bar — real status color, reserved for this use only. */
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

/** Primary CTA (gold fill, near-black text) — Generate / Next. */
function primaryButtonStyle(disabled: boolean) {
  return {
    backgroundColor: disabled ? "rgba(201,163,78,0.45)" : GOLD,
    color: NEAR_BLACK,
    border: "none",
    borderRadius: "10px",
    padding: "11px 22px",
    fontSize: "14px",
    fontWeight: 700 as const,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    opacity: disabled ? 0.7 : 1,
  };
}

/** Wizard Back/Next controls — always solid gold, never a disabled/grayed
 * state, since free step navigation removes the need to gate them. */
function wizardNavButtonStyle() {
  return {
    backgroundColor: GOLD,
    color: NEAR_BLACK,
    border: "none",
    borderRadius: "10px",
    padding: "11px 20px",
    fontSize: "14px",
    fontWeight: 700 as const,
    cursor: "pointer" as const,
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
  };
}

/** Secondary button on an ivory/white card (Copy, Download, Score, Humanize…) — dark navy outline, dark-gold text. */
function secondaryOnLightStyle(disabled: boolean) {
  return {
    backgroundColor: "transparent",
    border: `1.5px solid ${NAVY}`,
    color: GOLD_TEXT_ON_LIGHT,
    borderRadius: "8px",
    padding: "7px 14px",
    fontSize: "12px",
    fontWeight: 600 as const,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

const cardStyle = {
  backgroundColor: CARD_BG,
  borderRadius: "14px",
  padding: "20px",
  border: `1px solid ${CARD_BORDER}`,
  boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
};

const selectFieldStyle = {
  width: "100%",
  padding: "11px 14px",
  borderRadius: "10px",
  border: `1.5px solid ${CARD_BORDER}`,
  fontSize: "14px",
  color: TEXT_PRIMARY,
  backgroundColor: "#F3F1E9",
  outline: "none",
  cursor: "pointer",
};

const eyebrowStyle = {
  fontSize: "11px",
  fontWeight: 700 as const,
  color: GOLD_TEXT_ON_LIGHT,
  textTransform: "uppercase" as const,
  letterSpacing: "0.1em",
};

/** Companion panel shown beside the step card on the three sparser steps
 * (Select Opportunity, Customize, Generate) — real content, not filler,
 * so the wizard never leaves a large empty void beside a short step. */
function IntelligenceTipsPanel() {
  return (
    <div style={{ ...cardStyle, flex: "1", minWidth: "240px" }}>
      <p style={{ ...eyebrowStyle, marginBottom: "16px" }}>Intelligence tips</p>
      <div className="space-y-3.5">
        {INTELLIGENCE_TIPS.map((tip, i) => (
          <div
            key={i}
            style={{
              fontSize: "13px",
              color: TEXT_SECONDARY,
              lineHeight: "1.6",
              paddingLeft: "10px",
              borderLeft: `2px solid ${GOLD}`,
            }}
          >
            {tip}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Draft Generator - a real 4-step wizard (Select Opportunity, Customize,
 * Generate, Review & Export) grounded in the Knowledge Base (BLUEPRINT §4.8).
 * Only one step's content renders at a time; step, opportunity, template, and
 * generated-draft state all live at the page level so nothing is lost moving
 * back and forth between steps. organization_id is never sent from the
 * client - reads are RLS-scoped and writes derive it from the session
 * profile.
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
  const [opportunitySearch, setOpportunitySearch] = useState("");
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

  // Real per-opportunity match score (Select Opportunity step) - the same
  // combinedScore computeMatchFeed() ranks Match Feed with, fetched once for
  // the whole org so the wizard never invents a number.
  const [matchScores, setMatchScores] = useState<Map<string, MatchScoreEntry>>(new Map());
  const [matchScoresLoading, setMatchScoresLoading] = useState(true);

  // Real wizard step. Only completed steps (n < step) are clickable in the
  // rail. stepInitialized gates the one-time auto-jump that restores a
  // returning user straight to their last opportunity's step - after that,
  // navigation is entirely user-driven (Back/Next/rail clicks), never
  // re-derived from data state.
  const [step, setStep] = useState<WizardStep>(1);
  const [stepInitialized, setStepInitialized] = useState(false);

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

  // Real match score (Select Opportunity step) — reuses computeMatchFeed()
  // via its existing API route rather than a new endpoint/number. Fetched
  // once for the org; a high limit keeps every open opportunity in the map,
  // not just the top 25 shown on the Match Feed page itself.
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const res = await fetch("/api/intelligence/match-feed?limit=500");
        if (res.ok) {
          const data = (await res.json()) as {
            entries: { opportunityId: string; combinedScore: number; probabilityBlended: boolean }[];
          };
          if (active) {
            setMatchScores(
              new Map(
                data.entries.map((e) => [
                  e.opportunityId,
                  { combinedScore: e.combinedScore, probabilityBlended: e.probabilityBlended },
                ]),
              ),
            );
          }
        }
      } catch {
        // Match score is supplementary — silent failure leaves the map empty
        // and the UI honestly reports "not available" rather than a guess.
      } finally {
        if (active) setMatchScoresLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  // When the opportunity changes, clear the previous opportunity's draft
  // output (so it can never leak onto a different opportunity), reset
  // budget-specific state, then load the new opportunity's real history and
  // restore its latest draft if one exists.
  useEffect(() => {
    if (!opportunityId) {
      setVersions([]);
      setBudgetTable([]);
      setTotalRequested(null);
      return;
    }
    setBudgetTable([]);
    setTotalRequested(null);
    setDraftText("");
    setConfidence(null);
    setSources([]);
    setHumanizationStatus("not_humanized");
    setActiveVersionId(null);
    setRubric(null);
    setRubricInferred(false);
    setLogicModel(null);
    setDnaScore(null);
    void loadVersions(opportunityId, true);
  }, [opportunityId, loadVersions]);

  // Real, functional filter for the Select Opportunity step's search box —
  // case-insensitive substring match against the opportunity name.
  const filteredOpportunities = useMemo(() => {
    const q = opportunitySearch.trim().toLowerCase();
    if (!q) return opportunities;
    return opportunities.filter((o) => o.name.toLowerCase().includes(q));
  }, [opportunities, opportunitySearch]);

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

  // Returns whether generation succeeded, so the wizard can auto-advance to
  // Review & Export only on a real success (never on an error).
  const handleGenerate = useCallback(async (): Promise<boolean> => {
    if (!opportunityId || !templateType) return false;
    if (templateType === "budget_narrative" && !programId) return false;
    if (generatingRef.current) return false;
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
          return false;
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
        return true;
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
        return false;
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
      return true;
    } catch {
      setError("Network error while generating. Please try again.");
      return false;
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }, [opportunityId, templateType, programId, loadVersions, opportunities, runDNAScore, loadStatsAndRecent]);

  // Wizard-facing wrapper: generate, then advance to Review & Export only on
  // a real success — an error leaves the user on the Generate step with the
  // error message visible.
  async function handleGenerateClick() {
    const ok = await handleGenerate();
    if (ok) setStep(4);
  }

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

  // --- Wizard navigation: free jump to any step at any time. Back/Next are
  // convenience buttons only — the actual Generate action still validates
  // canGenerate below, but moving between steps never gates on it. ---
  function goNext() {
    setStep((s) => (Math.min(4, s + 1) as WizardStep));
  }
  function goBack() {
    setStep((s) => (Math.max(1, s - 1) as WizardStep));
  }
  function jumpToStep(n: WizardStep) {
    setStep(n);
  }

  // One-time restore: once opportunities have loaded (and, if an opportunity
  // was restored, once its versions have settled), start the wizard on the
  // step that matches the user's real state instead of always step 1. Runs
  // exactly once — every later step change is user-driven.
  useEffect(() => {
    if (stepInitialized || loading) return;
    if (!opportunityId) {
      setStep(1);
      setStepInitialized(true);
      return;
    }
    if (versionsLoading) return;
    setStep(hasDraft ? 4 : 2);
    setStepInitialized(true);
  }, [stepInitialized, loading, opportunityId, versionsLoading, hasDraft]);

  const selectedMatchScore = opportunityId ? matchScores.get(opportunityId) ?? null : null;

  const statNumberStyle = {
    fontSize: "18px",
    fontWeight: 800 as const,
    color: TEXT_PRIMARY,
    lineHeight: 1,
  };
  const statLabelStyle = {
    fontSize: "10px",
    fontWeight: 700 as const,
    color: TEXT_SECONDARY,
    textTransform: "uppercase" as const,
    letterSpacing: "0.06em",
  };

  return (
    <div className="space-y-6" style={{ backgroundColor: CHAMPAGNE, color: TEXT_ON_CHAMPAGNE, minHeight: "100vh", padding: "24px", fontFamily: "'Plus Jakarta Sans',sans-serif" }}>
      <div style={{ borderLeft: `4px solid ${NAVY}`, paddingLeft: "16px" }}>
        <h1 style={{ fontSize: "28px", fontWeight: 800, color: TEXT_ON_CHAMPAGNE, marginBottom: "4px" }}>
          Draft Generator
        </h1>
        <p style={{ fontSize: "14px", color: TEXT_ON_CHAMPAGNE_MUTED, marginBottom: "0" }}>
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

          {/* --- Wizard --- */}
          <div className="flex flex-col gap-6 lg:flex-row">
            <div
              style={{
                width: "200px",
                flexShrink: 0,
                alignSelf: "flex-start",
                position: "sticky",
                top: "24px",
                backgroundColor: NAVY,
                borderRadius: "14px",
                padding: "20px",
                border: "1px solid rgba(201,163,78,0.2)",
                boxShadow: "0 4px 16px rgba(0,0,0,0.35)",
              }}
            >
              <p
                style={{
                  fontSize: "11px",
                  fontWeight: 700,
                  letterSpacing: "0.15em",
                  color: TEXT_ON_DARK_MUTED,
                  textTransform: "uppercase",
                  marginBottom: "20px",
                  display: "block",
                }}
              >
                Grant Draft Wizard
              </p>
              {WIZARD_STEPS.map(({ n, label }) => {
                // Purely a progress indicator now — every step is clickable
                // at any time, regardless of this status.
                const status = n < step ? "done" : n === step ? "active" : "pending";
                return (
                  <button
                    key={n}
                    type="button"
                    onClick={() => jumpToStep(n)}
                    aria-current={status === "active" ? "step" : undefined}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "12px",
                      width: "100%",
                      textAlign: "left",
                      padding: "12px",
                      borderRadius: "8px",
                      border: "none",
                      marginBottom: "8px",
                      cursor: "pointer",
                      backgroundColor:
                        status === "active"
                          ? GOLD
                          : status === "done"
                            ? "rgba(255,255,255,0.08)"
                            : "rgba(255,255,255,0.04)",
                    }}
                  >
                    <span
                      style={{
                        width: "20px",
                        height: "20px",
                        borderRadius: "50%",
                        flexShrink: 0,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        fontSize: "11px",
                        fontWeight: 700,
                        backgroundColor:
                          status === "active" ? NEAR_BLACK : status === "done" ? GOLD : "transparent",
                        border: status === "pending" ? "1.5px solid rgba(248,245,238,0.3)" : "none",
                        color: status === "active" ? GOLD : status === "done" ? NEAR_BLACK : TEXT_ON_DARK_MUTED,
                      }}
                    >
                      {status === "done" ? <Check style={{ width: 12, height: 12 }} aria-hidden /> : n}
                    </span>
                    <span
                      style={{
                        fontSize: "13px",
                        fontWeight: status === "active" ? 700 : 600,
                        color:
                          status === "active"
                            ? NEAR_BLACK
                            : status === "done"
                              ? "rgba(248,245,238,0.85)"
                              : "rgba(248,245,238,0.55)",
                      }}
                    >
                      {label}
                    </span>
                  </button>
                );
              })}
            </div>

            <div style={{ flex: "1", display: "flex", flexDirection: "column", minWidth: 0, gap: "16px" }}>
              {/* Step 1 — Select Opportunity */}
              {step === 1 && (
                <div className="flex flex-col gap-4 lg:flex-row" style={{ minHeight: "420px" }}>
                  <div style={{ ...cardStyle, flex: "2" }}>
                    <p style={{ ...eyebrowStyle, marginBottom: "10px" }}>Choose an opportunity</p>
                    <div className="relative max-w-xl">
                      <Search
                        className="h-4 w-4"
                        style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: TEXT_SECONDARY }}
                        aria-hidden
                      />
                      <input
                        type="text"
                        value={opportunitySearch}
                        onChange={(e) => setOpportunitySearch(e.target.value)}
                        placeholder="Search opportunities by name…"
                        disabled={!editable}
                        aria-label="Search opportunities"
                        style={{ ...selectFieldStyle, paddingLeft: "38px", cursor: "text" }}
                      />
                    </div>
                    <div
                      className="max-w-xl"
                      style={{
                        marginTop: "12px",
                        maxHeight: "260px",
                        overflowY: "auto",
                        border: `1.5px solid ${CARD_BORDER}`,
                        borderRadius: "10px",
                      }}
                    >
                      {filteredOpportunities.length === 0 ? (
                        <p style={{ padding: "14px", fontSize: "13px", color: TEXT_SECONDARY }}>
                          No opportunities match &ldquo;{opportunitySearch}&rdquo;.
                        </p>
                      ) : (
                        filteredOpportunities.map((o) => {
                          const selected = o.id === opportunityId;
                          return (
                            <button
                              key={o.id}
                              type="button"
                              onClick={() => setOpportunityId(o.id)}
                              disabled={!editable}
                              aria-pressed={selected}
                              style={{
                                width: "100%",
                                textAlign: "left",
                                padding: "10px 14px",
                                border: "none",
                                borderBottom: `1px solid ${CARD_BORDER}`,
                                backgroundColor: selected ? GOLD_TINT_BG : "transparent",
                                cursor: editable ? "pointer" : "default",
                                display: "flex",
                                alignItems: "baseline",
                                gap: "8px",
                              }}
                            >
                              <span style={{ fontSize: "13px", fontWeight: 600, color: selected ? GOLD_TEXT_ON_LIGHT : TEXT_PRIMARY }}>
                                {o.name}
                              </span>
                              <span style={{ fontSize: "11px", color: TEXT_SECONDARY }}>
                                {humanizeEnum(o.category)}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                    {opportunityId && (
                      <div
                        style={{
                          marginTop: "14px",
                          maxWidth: "36rem",
                          padding: "12px 14px",
                          borderRadius: "10px",
                          backgroundColor: selectedMatchScore ? GOLD_TINT_BG : "rgba(11,11,11,0.04)",
                          border: `1px solid ${selectedMatchScore ? "rgba(201,163,78,0.35)" : CARD_BORDER}`,
                        }}
                      >
                        {matchScoresLoading ? (
                          <span style={{ fontSize: "12px", color: TEXT_SECONDARY }}>Loading match score…</span>
                        ) : selectedMatchScore ? (
                          <>
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                              <Target className="h-4 w-4" style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                              <span style={{ fontSize: "13px", fontWeight: 700, color: GOLD_TEXT_ON_LIGHT }}>
                                Match score: {selectedMatchScore.combinedScore}/100
                              </span>
                            </div>
                            <p style={{ fontSize: "12px", color: TEXT_SECONDARY, marginTop: "4px" }}>
                              {selectedMatchScore.probabilityBlended
                                ? "Blended from your mission/program fit and your win-probability score for this opportunity."
                                : "Based on mission and program fit against your Digital Twin — no win-probability score yet for this opportunity."}
                            </p>
                          </>
                        ) : (
                          <span style={{ fontSize: "12px", color: TEXT_SECONDARY }}>
                            Match score not available for this opportunity.
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <IntelligenceTipsPanel />
                </div>
              )}

              {/* Step 2 — Customize */}
              {step === 2 && (
                <div className="flex flex-col gap-4 lg:flex-row" style={{ minHeight: "420px" }}>
                  <div style={{ ...cardStyle, flex: "2" }}>
                    <p style={{ ...eyebrowStyle, marginBottom: "14px" }}>Choose a template</p>
                    <TemplateSelector
                      value={templateType}
                      onChange={setTemplateType}
                      disabled={!editable}
                    />

                    {templateType === "budget_narrative" && (
                      <div className="mt-6">
                        <p style={{ ...eyebrowStyle, marginBottom: "10px" }}>Choose a program</p>
                        <p className="mb-3 text-sm" style={{ color: TEXT_SECONDARY }}>
                          The budget will be scoped to this program&rsquo;s financial
                          data and your Knowledge Base budget justification entries.
                        </p>
                        <div className="max-w-xl space-y-2">
                          <Select
                            options={programOptions}
                            value={programId}
                            onChange={(e) => setProgramId(e.target.value)}
                            placeholder="Select a program..."
                            disabled={!editable}
                            aria-label="Program"
                            style={selectFieldStyle}
                          />
                          {programs.length === 0 && !loading && (
                            <p className="text-sm" style={{ color: TEXT_SECONDARY }}>
                              No programs found. Add programs in organization settings
                              first.
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <IntelligenceTipsPanel />
                </div>
              )}

              {/* Step 3 — Generate */}
              {step === 3 && (
                <div className="flex flex-col gap-4 lg:flex-row" style={{ minHeight: "420px" }}>
                <div className="text-center" style={{ ...cardStyle, flex: "2" }}>
                  {generating ? (
                    <>
                      <div
                        style={{
                          width: "80px",
                          height: "80px",
                          borderRadius: "50%",
                          background: `conic-gradient(${GOLD}, #E8C87A, ${GOLD})`,
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
                            backgroundColor: CARD_BG,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                          }}
                        >
                          <Sparkles className="h-6 w-6 animate-pulse" style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                        </div>
                      </div>
                      <p style={{ fontSize: "15px", fontWeight: 700, color: TEXT_PRIMARY }}>Generating your draft…</p>
                      <p style={{ fontSize: "13px", color: TEXT_SECONDARY, marginTop: "6px" }}>
                        Drawing on your Knowledge Base to write a grounded{" "}
                        {templateType ? humanizeEnum(templateType) : "draft"}. This can take a couple of minutes.
                      </p>
                    </>
                  ) : (
                    <>
                      {hasDraft && (
                        <div
                          style={{
                            marginBottom: "20px",
                            padding: "12px 14px",
                            borderRadius: "10px",
                            backgroundColor: GOLD_TINT_BG,
                            border: "1px solid rgba(201,163,78,0.35)",
                            textAlign: "left",
                          }}
                        >
                          <p style={{ fontSize: "13px", fontWeight: 700, color: GOLD_TEXT_ON_LIGHT }}>
                            A draft already exists for this opportunity
                            {confidence != null ? ` (confidence ${Math.round(confidence)}/100)` : ""}.
                          </p>
                          <p style={{ fontSize: "12px", color: TEXT_SECONDARY, marginTop: "4px" }}>
                            Continue to Review & Export, or generate a new version below.
                          </p>
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => void handleGenerateClick()}
                        disabled={!canGenerate || generating}
                        style={{ ...primaryButtonStyle(!canGenerate || generating), width: "100%", justifyContent: "center", padding: "14px" }}
                      >
                        <Sparkles className="h-4 w-4" aria-hidden />
                        {hasDraft ? "Generate new version" : "Generate draft"}
                      </button>
                      {!canGenerate && editable && (
                        <p style={{ fontSize: "12px", color: TEXT_SECONDARY, marginTop: "10px" }}>
                          Go back and finish selecting an opportunity and template first.
                        </p>
                      )}
                    </>
                  )}
                </div>
                <IntelligenceTipsPanel />
                </div>
              )}

              {/* Step 4 — Review & Export */}
              {step === 4 && !hasDraft && (
                <div style={{ ...cardStyle, textAlign: "center", padding: "48px 24px" }}>
                  <ShieldCheck className="mx-auto h-8 w-8" style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                  <p style={{ fontSize: "15px", fontWeight: 700, color: TEXT_PRIMARY, marginTop: "14px" }}>
                    No draft yet for this opportunity
                  </p>
                  <p style={{ fontSize: "13px", color: TEXT_SECONDARY, marginTop: "6px", maxWidth: "28rem", marginLeft: "auto", marginRight: "auto" }}>
                    Generate a draft on the Generate step first, then come back here to review, humanize, and export it.
                  </p>
                  <button
                    type="button"
                    onClick={() => setStep(3)}
                    style={{ ...primaryButtonStyle(false), margin: "18px auto 0" }}
                  >
                    Go to Generate
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                </div>
              )}
              {step === 4 && hasDraft && (
                <div className="flex flex-col gap-6 xl:flex-row" style={{ minHeight: "600px" }}>
                  <div className="flex flex-1 flex-col gap-4" style={{ minWidth: 0 }}>
                    <div
                      style={{
                        backgroundColor: CARD_BG,
                        borderRadius: "14px",
                        padding: "24px",
                        border: `1px solid ${CARD_BORDER}`,
                        borderTop: `4px solid ${NAVY}`,
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
                          <span style={eyebrowStyle}>
                            Review &amp; edit
                          </span>
                          {confidence != null && (
                            <span
                              style={{
                                fontSize: "13px",
                                fontWeight: 800,
                                color: confidenceBarColor(confidence),
                                backgroundColor: "#F3F1E9",
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
                              className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed"
                              style={secondaryOnLightStyle(!draftText.trim() || dnaScoring)}
                            >
                              <Dna className={`h-3.5 w-3.5 ${dnaScoring ? "animate-spin" : ""}`} style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                              {dnaScoring ? "Scoring..." : "Score Draft"}
                            </button>
                            <button
                              type="button"
                              onClick={handleHumanize}
                              disabled={!draftText.trim() || generating || humanizing}
                              title="Rewrite this draft to read like a human wrote it"
                              className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed"
                              style={secondaryOnLightStyle(!draftText.trim() || generating || humanizing)}
                            >
                              <Wand2 className="h-4 w-4" style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                              {humanizing ? "Humanizing..." : "Humanize"}
                            </button>
                            {draftText.trim() && (
                              <button
                                type="button"
                                onClick={handleRescore}
                                title="Recalculate score from current draft text"
                                className="inline-flex items-center gap-1.5 disabled:cursor-not-allowed"
                                style={secondaryOnLightStyle(false)}
                              >
                                <RefreshCw className="h-3.5 w-3.5" style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                                Rescore
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {confidence != null ? (
                        <div style={{ marginBottom: "16px" }}>
                          <div style={{ backgroundColor: CARD_BORDER, borderRadius: "4px", height: "6px" }}>
                            <div
                              style={{
                                width: `${Math.max(0, Math.min(100, Math.round(confidence)))}%`,
                                height: "100%",
                                borderRadius: "4px",
                                backgroundColor: confidenceBarColor(confidence),
                              }}
                            />
                          </div>
                          <p style={{ fontSize: "12px", color: TEXT_SECONDARY, marginTop: "6px" }}>
                            {confidenceStatusText(confidence)}
                            {belowThreshold && " This draft falls below your review threshold."}
                          </p>
                          {rescoreMessage && (
                            <p style={{ fontSize: "12px", color: GOLD_TEXT_ON_LIGHT, marginTop: "4px", fontWeight: 600 }}>
                              {rescoreMessage}
                            </p>
                          )}
                        </div>
                      ) : (
                        <p style={{ fontSize: "12px", color: TEXT_SECONDARY, marginBottom: "16px" }}>
                          No confidence score recorded for this draft.
                        </p>
                      )}

                      <p style={{ fontSize: "13px", color: TEXT_SECONDARY, marginBottom: "16px" }}>
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
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "16px", padding: "10px 0 0", borderTop: `1px solid ${CARD_BORDER}`, marginTop: "12px" }}>
                          <span style={{ fontSize: "12px", color: TEXT_SECONDARY, display: "flex", alignItems: "center", gap: "4px" }}>
                            Grade {readability.gradeLevel.toFixed(1)} reading level
                          </span>
                          <span style={{ fontSize: "12px", color: TEXT_SECONDARY, display: "flex", alignItems: "center", gap: "4px" }}>
                            {readability.passivePercent.toFixed(0)}% passive voice
                          </span>
                          <span style={{ fontSize: "12px", color: TEXT_SECONDARY, display: "flex", alignItems: "center", gap: "4px" }}>
                            {readability.wordCount.toLocaleString()} words
                          </span>
                          <span style={{ fontSize: "12px", color: TEXT_SECONDARY, marginLeft: "auto" }}>
                            Ideal: Grade 10–12, &lt;15% passive
                          </span>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3" style={{ borderColor: CARD_BORDER }}>
                        <button
                          type="button"
                          onClick={handleCopyToClipboard}
                          disabled={!draftText.trim()}
                          className="inline-flex items-center gap-1.5 transition"
                          style={secondaryOnLightStyle(!draftText.trim())}
                        >
                          {copiedToClipboard ? (
                            <Check className="h-3.5 w-3.5 text-green-500" aria-hidden />
                          ) : (
                            <Clipboard className="h-3.5 w-3.5" style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                          )}
                          {copiedToClipboard ? "Copied!" : "Copy to clipboard"}
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadTxt}
                          disabled={!draftText.trim()}
                          className="inline-flex items-center gap-1.5 transition"
                          style={secondaryOnLightStyle(!draftText.trim())}
                        >
                          <Download className="h-3.5 w-3.5" style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                          Download .txt
                        </button>
                        <button
                          type="button"
                          onClick={handleDownloadPdf}
                          disabled={!draftText.trim()}
                          className="inline-flex items-center gap-1.5 transition"
                          style={secondaryOnLightStyle(!draftText.trim())}
                        >
                          <Download className="h-3.5 w-3.5" style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                          Download PDF
                        </button>
                        <button
                          type="button"
                          disabled
                          title="Connect Gmail to enable"
                          className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium opacity-50"
                          style={{ backgroundColor: "#F3F1E9", border: `1px solid ${CARD_BORDER}`, color: "#9C9587" }}
                        >
                          <MailIcon className="h-3.5 w-3.5" aria-hidden />
                          Email draft
                        </button>
                        <span className="text-xs" style={{ color: "#9C9587" }}>Connect Gmail to enable email</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-6" style={{ width: "240px", flexShrink: 0 }}>
                    {/* Sources used — the trust signal for this draft. Made
                        deliberately prominent: larger header, real icon, gold
                        accent bar, positioned first in the review column. */}
                    <div
                      style={{
                        backgroundColor: CARD_BG,
                        borderRadius: "14px",
                        border: `1px solid ${CARD_BORDER}`,
                        borderLeft: `4px solid ${GOLD}`,
                        boxShadow: "0 2px 8px rgba(0,0,0,0.06)",
                        padding: "18px",
                      }}
                    >
                      <div className="mb-3 flex items-center gap-2">
                        <ShieldCheck className="h-5 w-5" style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                        <h3 style={{ fontSize: "16px", fontWeight: 800, color: NAVY }}>Sources used</h3>
                      </div>
                      <p style={{ fontSize: "11px", color: TEXT_SECONDARY, marginBottom: "12px" }}>
                        Every fact in this draft traces back to one of these — nothing was invented.
                      </p>
                      <KnowledgePreview sources={sources} />
                    </div>

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
                          className="rounded-xl p-5"
                          style={{
                            backgroundColor: CARD_BG,
                            boxShadow: "0 2px 8px rgba(16,27,45,0.08)",
                            border: `1px solid ${CARD_BORDER}`,
                          }}
                        >
                          <div className="mb-3 flex items-center gap-2">
                            <Dna className="h-4 w-4 animate-spin" style={{ color: GOLD_TEXT_ON_LIGHT }} aria-hidden />
                            <h3 style={{ fontSize: "16px", fontWeight: 700, color: TEXT_PRIMARY }}>Grant DNA Score</h3>
                          </div>
                          <div className="h-[220px] animate-pulse rounded-lg" style={{ backgroundColor: "#F3F1E9" }} />
                        </div>
                      )
                    )}

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
                                    className="min-w-0 truncate text-xs font-semibold"
                                    style={{ color: NAVY }}
                                    title={section.name}
                                  >
                                    {section.name}
                                  </span>
                                  <div className="flex shrink-0 items-center gap-1.5">
                                    <span className="text-xs" style={{ color: TEXT_SECONDARY }}>{words}w</span>
                                    <span className={"text-xs font-bold " + scoreColor}>
                                      {score}/100
                                    </span>
                                  </div>
                                </div>
                                {score < 80 && (
                                  <p className="mt-0.5 text-xs leading-snug" style={{ color: TEXT_SECONDARY }}>
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
                              style={{ borderColor: CARD_BORDER }}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium capitalize" style={{ color: NAVY }}>
                                  {item.category}
                                </p>
                                <p className="mt-0.5 text-xs leading-snug" style={{ color: TEXT_SECONDARY }}>
                                  {item.justification}
                                </p>
                              </div>
                              <div className="shrink-0 text-right">
                                <p className="font-mono text-sm" style={{ color: NAVY }}>
                                  {item.amount != null
                                    ? formatCurrency(item.amount)
                                    : "[NEEDS INPUT]"}
                                </p>
                                {item.percentage != null && (
                                  <p className="text-xs" style={{ color: TEXT_SECONDARY }}>
                                    {item.percentage.toFixed(1)}%
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                          {totalRequested != null && (
                            <div className="mt-1 flex items-center justify-between pt-2" style={{ borderTop: `2px solid ${GOLD}` }}>
                              <p className="text-sm font-semibold" style={{ color: NAVY }}>
                                Total requested
                              </p>
                              <p className="font-mono text-sm font-semibold" style={{ color: NAVY }}>
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

              {/* Back / Next wizard controls — always solid gold, never
                  disabled. Free navigation (rail clicks, Back, Next) never
                  gates on validation; only the real Generate action below
                  does. */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <button type="button" onClick={goBack} style={wizardNavButtonStyle()}>
                  <ArrowLeft className="h-4 w-4" aria-hidden />
                  Back
                </button>
                {step < 4 ? (
                  <button type="button" onClick={goNext} style={wizardNavButtonStyle()}>
                    Next
                    <ArrowRight className="h-4 w-4" aria-hidden />
                  </button>
                ) : (
                  <span />
                )}
              </div>
            </div>
          </div>

          {/* Stats strip — moved below the wizard, shrunk to a slim single row. */}
          <div style={{ display: "flex", flexWrap: "wrap", backgroundColor: CARD_BG, border: `1px solid ${CARD_BORDER}`, borderRadius: "10px", overflow: "hidden" }}>
            <div style={{ flex: "1 1 auto", minWidth: "140px", display: "flex", alignItems: "baseline", gap: "8px", padding: "12px 18px", borderRight: `1px solid ${CARD_BORDER}` }}>
              <span style={statNumberStyle}>{stats ? stats.totalDrafts : "—"}</span>
              <span style={statLabelStyle}>Total Drafts</span>
            </div>
            <div style={{ flex: "1 1 auto", minWidth: "140px", display: "flex", alignItems: "baseline", gap: "8px", padding: "12px 18px", borderRight: `1px solid ${CARD_BORDER}` }}>
              <span style={statNumberStyle}>{stats ? stats.aiPending : "—"}</span>
              <span style={statLabelStyle}>AI Drafts Pending</span>
              <span
                style={{
                  backgroundColor: GOLD_TINT_BG,
                  color: GOLD_TEXT_ON_LIGHT,
                  fontSize: "10px",
                  fontWeight: 700,
                  borderRadius: "999px",
                  padding: "1px 7px",
                  marginLeft: "2px",
                }}
              >
                AI
              </span>
            </div>
            <div style={{ flex: "1 1 auto", minWidth: "140px", display: "flex", alignItems: "baseline", gap: "8px", padding: "12px 18px", borderRight: `1px solid ${CARD_BORDER}` }}>
              <span style={statNumberStyle}>{stats ? stats.draftsThisMonth : "—"}</span>
              <span style={statLabelStyle}>Drafts This Month</span>
            </div>
            <div style={{ flex: "1 1 auto", minWidth: "140px", display: "flex", alignItems: "baseline", gap: "8px", padding: "12px 18px" }}>
              <span style={statNumberStyle}>
                {stats && stats.avgConfidence != null ? `${stats.avgConfidence}/100` : "—"}
              </span>
              <span style={statLabelStyle}>Avg Confidence</span>
            </div>
          </div>

          <div
            style={{
              backgroundColor: CARD_BG,
              borderRadius: "14px",
              overflow: "hidden",
              border: `1px solid ${CARD_BORDER}`,
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <div
              role="row"
              style={{
                backgroundColor: "#F3F1E9",
                padding: "14px 20px",
                display: "flex",
                gap: "24px",
                borderBottom: `1px solid ${CARD_BORDER}`,
              }}
            >
              <span style={{ flex: 2, fontSize: "11px", fontWeight: 700, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Opportunity
              </span>
              <span style={{ flex: 1, fontSize: "11px", fontWeight: 700, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Template
              </span>
              <span style={{ flex: "0 0 90px", fontSize: "11px", fontWeight: 700, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Confidence
              </span>
              <span style={{ flex: "0 0 110px", fontSize: "11px", fontWeight: 700, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Source
              </span>
              <span style={{ flex: "0 0 90px", fontSize: "11px", fontWeight: 700, color: TEXT_SECONDARY, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Created
              </span>
              <span style={{ flex: "0 0 50px" }} />
            </div>
            {recentDraftsLoading ? (
              <div className="p-5 text-sm" style={{ color: TEXT_SECONDARY }}>Loading recent drafts…</div>
            ) : recentDrafts.length === 0 ? (
              <div className="p-5 text-sm" style={{ color: TEXT_SECONDARY }}>
                No drafts generated yet. Generate one above to see it here.
              </div>
            ) : (
              recentDrafts.map((draft) => (
                <div
                  key={draft.id}
                  role="row"
                  style={{ padding: "12px 20px", display: "flex", alignItems: "center", gap: "16px", borderBottom: "1px solid #F1EEE3" }}
                >
                  <span className="truncate" style={{ flex: 2, fontSize: "13px", fontWeight: 600, color: TEXT_PRIMARY }}>
                    {draft.opportunityName}
                  </span>
                  <span style={{ flex: 1, fontSize: "12px", color: TEXT_SECONDARY }}>
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
                      <span style={{ color: "#9C9587", fontSize: "12px" }}>—</span>
                    )}
                  </span>
                  <span style={{ flex: "0 0 110px" }}>
                    {draft.source === "generated" ? (
                      <span
                        style={{
                          backgroundColor: GOLD_TINT_BG,
                          color: GOLD_TEXT_ON_LIGHT,
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
                      <span style={{ fontSize: "11px", color: "#9C9587" }}>{humanizeEnum(draft.source)}</span>
                    )}
                  </span>
                  <span style={{ flex: "0 0 90px", fontSize: "12px", color: "#9C9587" }}>
                    {new Date(draft.createdAt).toLocaleDateString()}
                  </span>
                  <span style={{ flex: "0 0 50px" }}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpportunityId(draft.opportunityId);
                        setStep(4);
                        setStepInitialized(true);
                      }}
                      style={{ color: GOLD_TEXT_ON_LIGHT, fontSize: "13px", fontWeight: 600, background: "none", border: "none", cursor: "pointer" }}
                    >
                      Open
                    </button>
                  </span>
                </div>
              ))
            )}
          </div>

          {opportunityId && (
            <div style={{ backgroundColor: CARD_BG, borderRadius: "14px", padding: "20px", border: `1px solid ${CARD_BORDER}` }}>
              <p style={{ fontSize: "13px", fontWeight: 700, color: TEXT_PRIMARY, marginBottom: "14px" }}>
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
