"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle, Sparkles, Wand2 } from "lucide-react";

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
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import type {
  DraftResult,
  DraftTemplateType,
  HumanizationStatus,
  HumanizeResult,
  KnowledgeSource,
} from "@/types/ai";
import type { Json, Tables } from "@/types/database";

type OpportunityOption = { id: string; name: string; category: string };

/** Badge styling for the active draft's humanization status (mirrors history). */
const HUMANIZATION_BADGE: Record<
  HumanizationStatus,
  { label: string; color: "gray" | "green" | "yellow" | "red" }
> = {
  not_humanized: { label: "Not humanized", color: "gray" },
  pending: { label: "Humanizing…", color: "yellow" },
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
 * Draft Generator — template selection + generation flow (BLUEPRINT §4.8).
 * Pick an opportunity and template, generate a draft grounded in the Knowledge
 * Base, review the confidence and sources, then save it onto an application
 * record and open the editor. organization_id is never sent from the client —
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
  const [loading, setLoading] = useState(true);

  const [opportunityId, setOpportunityId] = useState("");
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

  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);

  const [versions, setVersions] = useState<DraftVersionItem[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);

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
  // latest into the editor — used when switching opportunities / on restore.
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

  // Initial load: opportunities + restore the user's most recent draft.
  useEffect(() => {
    let active = true;
    const supabase = createClient();
    (async () => {
      const { data, error: oppError } = await supabase
        .from("opportunities")
        .select("id, name, category")
        .order("created_at", { ascending: false });
      if (!active) return;
      if (oppError) {
        setError("Could not load opportunities.");
        setLoading(false);
        return;
      }
      const loaded = (data ?? []) as OpportunityOption[];
      setOpportunities(loaded);

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

  // When the opportunity changes, load its history and latest draft.
  useEffect(() => {
    if (!opportunityId) {
      setVersions([]);
      return;
    }
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

  const canGenerate = Boolean(opportunityId && templateType) && editable;
  const hasDraft = draftText.trim() !== "" || confidence != null;

  async function handleGenerate() {
    if (!opportunityId || !templateType) return;
    setGenerating(true);
    setError(null);

    try {
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
      setHumanizationStatus(payload.savedVersion?.humanizationStatus ?? "not_humanized");
      setActiveVersionId(payload.savedVersion?.id ?? null);
      // Refresh the history panel to include the just-saved version.
      await loadVersions(opportunityId, false);
    } catch {
      setError("Network error while generating the draft. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  // Second pass: rewrite the current draft for an authentic human voice
  // (anti-detection). The endpoint appends a new humanized version and returns
  // a confidence score that reflects the humanization (BLUEPRINT §4.8).
  async function handleHumanize() {
    if (!opportunityId || !templateType || !draftText.trim()) return;
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

      // Replace the editor content with the humanized draft and reflect its
      // humanized status + updated confidence.
      setDraftText(payload.content);
      setConfidence(payload.confidenceScore);
      setSources(payload.sources);
      setHumanizationStatus(payload.humanizationStatus);
      setActiveVersionId(payload.savedVersion?.id ?? null);
      await loadVersions(opportunityId, false);
    } catch {
      setError("Network error while humanizing the draft. Please try again.");
    } finally {
      setHumanizing(false);
    }
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
          Draft Generator
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Generate an application draft from your Knowledge Base. The AI never
          invents organizational facts — gaps are flagged for your input.
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
        <LoadingSpinner center label="Loading opportunities…" />
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

          <Card title="1. Choose an opportunity">
            <div className="max-w-xl">
              <Select
                options={opportunityOptions}
                value={opportunityId}
                onChange={(e) => setOpportunityId(e.target.value)}
                placeholder="Select an opportunity…"
                disabled={!editable || generating}
                aria-label="Opportunity"
              />
            </div>
          </Card>

          <Card title="2. Choose a template">
            <TemplateSelector
              value={templateType}
              onChange={setTemplateType}
              disabled={!editable || generating}
            />
          </Card>

          <div className="flex justify-end">
            <Button
              onClick={handleGenerate}
              isLoading={generating}
              disabled={!canGenerate}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              {generating
                ? "Generating…"
                : hasDraft
                  ? "Generate new version"
                  : "Generate draft"}
            </Button>
          </div>

          {hasDraft && (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
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
                  title="3. Review &amp; edit"
                  description="Humanize rewrites the draft in an authentic human voice (no em dashes, no AI clichés, varied rhythm), grounded in your verified data."
                  actions={
                    editable ? (
                      <Button
                        variant="secondary"
                        onClick={handleHumanize}
                        isLoading={humanizing}
                        disabled={!draftText.trim() || generating || humanizing}
                        title="Rewrite this draft to read like a human wrote it"
                      >
                        <Wand2 className="h-4 w-4" aria-hidden />
                        {humanizing ? "Humanizing…" : "Humanize"}
                      </Button>
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
                </Card>
              </div>

              <div className="space-y-6">
                <Card
                  title="Confidence"
                  actions={
                    <Badge color={HUMANIZATION_BADGE[humanizationStatus].color}>
                      {HUMANIZATION_BADGE[humanizationStatus].label}
                    </Badge>
                  }
                >
                  {confidence != null ? (
                    <ConfidenceIndicator score={confidence} />
                  ) : (
                    <p className="text-sm text-navy-500">
                      No confidence score recorded for this draft.
                    </p>
                  )}
                  {humanizationStatus === "humanized" && (
                    <p className="mt-2 text-xs text-navy-500">
                      This draft has been humanized. The score reflects both how
                      well it&rsquo;s grounded in your data and how natural it
                      reads.
                    </p>
                  )}
                </Card>
                <Card title="Sources used">
                  <KnowledgePreview sources={sources} />
                </Card>
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
