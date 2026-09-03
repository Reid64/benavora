"use client";

import { useCallback, useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  DocumentList,
  type ApplicationOption,
} from "@/components/documents/DocumentList";
import { DocumentUploader } from "@/components/documents/DocumentUploader";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import type { Tables } from "@/types/database";

// Applications & Pipeline section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Deep Navy. Secondary accent: Teal.
const FRAME_NAVY = "#2C4E3B";
const ACCENT_TEAL = "#2E6B66";
const CARD_BG = "#F8F5EE";
const SHADOW = "0 4px 20px rgba(44,78,59,0.22)";

/**
 * Document repository (BLUEPRINT §4.6, Behavioral Contracts §7). Reads are
 * RLS-scoped to the organization, so no client-side organization_id filter is
 * needed. Uploads go to the org's Storage bucket and write metadata to the
 * documents table; documents can be linked to applications via the
 * application_documents junction.
 */
export default function DocumentsPage() {
  const { profile } = useProfile();
  const [documents, setDocuments] = useState<Tables<"documents">[]>([]);
  const [applications, setApplications] = useState<ApplicationOption[]>([]);
  const [linksByDocument, setLinksByDocument] = useState<
    Record<string, string[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const supabase = createClient();

    const [documentsRes, applicationsRes, opportunitiesRes, linksRes] =
      await Promise.all([
        supabase
          .from("documents")
          .select("*")
          .order("created_at", { ascending: false })
          .limit(1000),
        supabase.from("applications").select("id, opportunity_id"),
        supabase.from("opportunities").select("id, name"),
        supabase
          .from("application_documents")
          .select("application_id, document_id"),
      ]);

    if (documentsRes.error) {
      setError("Could not load documents.");
      setLoading(false);
      return;
    }

    const opportunityNames = new Map<string, string>();
    for (const opp of opportunitiesRes.data ?? []) {
      opportunityNames.set(opp.id, opp.name);
    }

    const appLabels = new Map<string, string>();
    const appOptions: ApplicationOption[] = (applicationsRes.data ?? []).map(
      (app) => {
        const label = app.opportunity_id
          ? (opportunityNames.get(app.opportunity_id) ?? "Application")
          : "Application";
        appLabels.set(app.id, label);
        return { id: app.id, label };
      },
    );

    // Build document -> application-label map. Both ends are RLS-scoped to the
    // org; we only include links whose application is in our known set.
    const links: Record<string, string[]> = {};
    for (const link of linksRes.data ?? []) {
      const label = appLabels.get(link.application_id);
      if (!label) continue;
      (links[link.document_id] ??= []).push(label);
    }

    setDocuments(documentsRes.data ?? []);
    setApplications(appOptions);
    setLinksByDocument(links);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = canEdit(profile?.role);
  const showEmpty = !loading && !error && documents.length === 0;

  return (
    <div className="min-h-screen space-y-6 p-6">
      <PageHeader
        accent={FRAME_NAVY}
        title="Documents"
        description="Upload, categorize, and attach supporting files to applications."
      />

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {editable && profile && (
        <div style={{ backgroundColor: FRAME_NAVY, borderRadius: "14px", boxShadow: SHADOW, padding: "4px" }}>
          <div
            style={{ backgroundColor: CARD_BG, borderRadius: "11px", boxShadow: "inset 0 1px 2px rgba(44,78,59,0.06)" }}
            className="p-5"
          >
            <DocumentUploader
              organizationId={profile.organization_id}
              uploadedBy={profile.id}
              onUploaded={load}
              accentColor={ACCENT_TEAL}
            />
          </div>
        </div>
      )}

      {showEmpty ? (
        <EmptyState
          icon={FolderOpen}
          title="No documents yet"
          description={
            editable
              ? "Upload your tax letter, financials, and program materials to reuse them across applications."
              : "Documents uploaded by your team will appear here."
          }
        />
      ) : (
        profile && (
          <DocumentList
            documents={documents}
            organizationId={profile.organization_id}
            applications={applications}
            linksByDocument={linksByDocument}
            editable={editable}
            onChanged={load}
            isLoading={loading}
          />
        )
      )}
    </div>
  );
}
