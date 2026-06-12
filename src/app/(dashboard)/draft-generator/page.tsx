"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Sparkles, Wand2 } from "lucide-react";

import {
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
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { DraftResult, DraftTemplateType } from "@/types/ai";
import type { Json } from "@/types/database";

type OpportunityOption = { id: string; name: string; category: string };

/**
 * Draft Generator — template selection + generation flow (BLUEPRINT §4.8).
 * Pick an opportunity and template, generate a draft grounded in the Knowledge
 * Base, review the confidence and sources, then save it onto an application
 * record and open the editor. organization_id is never sent from the client —
 * reads are RLS-scoped and writes derive it from the session profile.
 */
export default function DraftGeneratorPage() {
  const router = useRouter();
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [opportunities, setOpportunities] = useState<OpportunityOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [opportunityId, setOpportunityId] = useState("");
  const [templateType, setTemplateType] = useState<DraftTemplateType | null>(
    null,
  );

  const [generating, setGenerating] = useState(false);
  const [result, setResult] = useState<DraftResult | null>(null);
  const [draftText, setDraftText] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);

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
      } else {
        setOpportunities((data ?? []) as OpportunityOption[]);
      }
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, []);

  const opportunityOptions = useMemo(
    () =>
      opportunities.map((o) => ({
        value: o.id,
        label: `${o.name} · ${humanizeEnum(o.category)}`,
      })),
    [opportunities],
  );

  const canGenerate = Boolean(opportunityId && templateType) && editable;

  async function handleGenerate() {
    if (!opportunityId || !templateType) return;
    setGenerating(true);
    setError(null);
    setResult(null);

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

      setResult(payload);
      setDraftText(payload.content);
    } catch {
      setError("Network error while generating the draft. Please try again.");
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!result || !templateType || !opportunityId) return;
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
      draft_confidence_score: result.confidenceScore,
      draft_knowledge_sources: result.sources as unknown as Json,
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

    router.push(`/draft-generator/${applicationId}`);
  }

  const belowThreshold =
    result != null && result.confidenceScore < AI_CONFIDENCE_THRESHOLD;

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
              {generating ? "Generating…" : "Generate draft"}
            </Button>
          </div>

          {result && (
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
                <Card title="3. Review &amp; edit">
                  <DraftEditor
                    value={draftText}
                    onChange={setDraftText}
                    onSave={handleSave}
                    saving={saving}
                    label="Generated draft"
                  />
                </Card>
              </div>

              <div className="space-y-6">
                <Card title="Confidence">
                  <ConfidenceIndicator score={result.confidenceScore} />
                </Card>
                <Card title="Sources used">
                  <KnowledgePreview sources={result.sources} />
                </Card>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
