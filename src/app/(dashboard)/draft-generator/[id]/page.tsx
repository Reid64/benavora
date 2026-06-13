"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, ExternalLink, Sparkles } from "lucide-react";

import {
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
} from "@/components/ui";
import { DraftEditor } from "@/components/draft-generator/DraftEditor";
import { ConfidenceIndicator } from "@/components/draft-generator/ConfidenceIndicator";
import { KnowledgePreview } from "@/components/draft-generator/KnowledgePreview";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { AI_CONFIDENCE_THRESHOLD } from "@/lib/utils/constants";
import { humanizeEnum } from "@/lib/utils/formatters";
import type { DraftResult, KnowledgeSource } from "@/types/ai";
import type { Json, Tables } from "@/types/database";

type LoadedDraft = {
  application: Tables<"applications">;
  opportunityName: string | null;
  sources: KnowledgeSource[];
};

/** Defensively parse applications.draft_knowledge_sources (jsonb) into sources. */
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

/**
 * Draft editor with AI assist (BLUEPRINT §4.8). Loads the draft stored on an
 * application, lets the writer edit and save it, shows the confidence and the
 * Knowledge Base sources that informed it, and can regenerate via the same
 * grounded /api/ai/draft route. All reads are RLS-scoped; the id is the
 * application id from the route, never a request body.
 */
export default function DraftEditorPage({
  params,
}: {
  params: { id: string };
}) {
  const router = useRouter();
  const { profile } = useProfile();
  const editable = canEdit(profile?.role);

  const [data, setData] = useState<LoadedDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [draftText, setDraftText] = useState("");
  const [confidence, setConfidence] = useState<number | null>(null);
  const [sources, setSources] = useState<KnowledgeSource[]>([]);

  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: application, error: appError } = await supabase
      .from("applications")
      .select("*")
      .eq("id", params.id)
      .single();

    if (appError || !application) {
      setError("This draft could not be found.");
      setLoading(false);
      return;
    }

    const { data: opportunity } = await supabase
      .from("opportunities")
      .select("name")
      .eq("id", application.opportunity_id)
      .single();

    const parsedSources = parseSources(
      application.draft_knowledge_sources as Json | null,
    );

    setData({
      application: application as Tables<"applications">,
      opportunityName: (opportunity?.name as string | null) ?? null,
      sources: parsedSources,
    });
    setDraftText((application.draft_content as string | null) ?? "");
    setConfidence(
      (application.draft_confidence_score as number | null) ?? null,
    );
    setSources(parsedSources);
    setLoading(false);
  }, [params.id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave() {
    if (!data) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("applications")
      .update({
        draft_content: draftText,
        draft_confidence_score: confidence,
        draft_knowledge_sources: sources as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.application.id);

    setSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setNotice("Draft saved.");
  }

  async function handleRegenerate() {
    if (!data) return;
    const templateType = data.application.draft_template_type;
    if (!templateType) {
      setError(
        "This draft has no template type. Start a new draft from the generator.",
      );
      return;
    }
    setRegenerating(true);
    setError(null);
    setNotice(null);

    try {
      const res = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opportunityId: data.application.opportunity_id,
          templateType,
        }),
      });
      const payload = (await res.json()) as
        | DraftResult
        | { error: string; code: string };

      if (!res.ok || !("content" in payload)) {
        setError(
          "error" in payload
            ? payload.error
            : "The draft could not be regenerated.",
        );
        return;
      }

      setDraftText(payload.content);
      setConfidence(payload.confidenceScore);
      setSources(payload.sources);
      setNotice("Regenerated. Review and save to keep these changes.");
    } catch {
      setError("Network error while regenerating. Please try again.");
    } finally {
      setRegenerating(false);
    }
  }

  if (loading) {
    return <LoadingSpinner center label="Loading draft..." />;
  }

  if (error && !data) {
    return (
      <EmptyState
        icon={Sparkles}
        title="Draft unavailable"
        description={error}
        action={
          <Button
            variant="secondary"
            onClick={() => router.push("/draft-generator")}
          >
            Back to Draft Generator
          </Button>
        }
      />
    );
  }

  if (!data) return null;

  const belowThreshold =
    confidence != null && confidence < AI_CONFIDENCE_THRESHOLD;

  return (
    <div className="space-y-6">
      <Link
        href="/draft-generator"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to Draft Generator
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            {data.opportunityName ?? "Draft"}
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            {data.application.draft_template_type
              ? humanizeEnum(data.application.draft_template_type)
              : "Draft"}{" "}
            ·{" "}
            <Link
              href={`/applications/${data.application.id}`}
              className="inline-flex items-center gap-1 text-teal-600 hover:text-teal-700"
            >
              View application
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </p>
        </div>
        {editable && (
          <Button
            variant="secondary"
            onClick={handleRegenerate}
            isLoading={regenerating}
          >
            <Sparkles className="h-4 w-4" aria-hidden />
            Regenerate with AI
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-700">
          {notice}
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {belowThreshold && (
            <div
              role="alert"
              className="flex items-start gap-2 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-900"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>
                This draft contains AI-generated content not verified against
                your Knowledge Base. Review carefully before submission.
              </span>
            </div>
          )}
          <Card>
            <DraftEditor
              value={draftText}
              onChange={setDraftText}
              onSave={editable ? handleSave : undefined}
              saving={saving}
              readOnly={!editable}
              label="Draft content"
            />
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Confidence">
            {confidence != null ? (
              <ConfidenceIndicator score={confidence} />
            ) : (
              <p className="text-sm text-navy-500">
                No confidence score recorded for this draft.
              </p>
            )}
          </Card>
          <Card title="Sources used">
            <KnowledgePreview sources={sources} />
          </Card>
        </div>
      </div>
    </div>
  );
}
