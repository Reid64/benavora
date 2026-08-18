"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { Mail, Radar, Send } from "lucide-react";

import { Button, EmptyState, Input, Modal } from "@/components/ui";
import { OutreachContactTable } from "@/components/outreach/OutreachContactTable";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import type { Tables } from "@/types/database";

// Outreach & Communication section treatment — PAGE_TREATMENT_PROTOCOL_V2.md.
// Frame: Rust. Secondary accent: Bronze.
const FRAME_RUST = "#A3492F";
const ACCENT_BRONZE = "#A4712C";
const CARD_BG = "#F8F5EE";

/**
 * Cold outreach contact list (BLUEPRINT §4.11). Lists companies extracted by
 * the Cold Outreach Agent with status and giving-likelihood, supports
 * Convert-to-Funder, and lets an editor scan a new company (which runs Agent 11
 * via /api/agents/outreach). Reads are RLS-scoped to the organization.
 */
export default function OutreachPage() {
  const { profile } = useProfile();
  const [contacts, setContacts] = useState<Tables<"outreach_contacts">[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("outreach_contacts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1000);

    if (loadError) {
      setError("Could not load outreach contacts.");
      setLoading(false);
      return;
    }
    setContacts(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const editable = canEdit(profile?.role);
  const showEmpty = !loading && !error && contacts.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" style={{ color: FRAME_RUST }}>
            Outreach
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Contacts extracted from companies without a giving page. Convert the
            promising ones into funders.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/email/campaigns">
            <Button
              variant="ghost"
              style={{
                border: `1.5px solid ${ACCENT_BRONZE}`,
                backgroundColor: "rgba(164,113,44,0.08)",
                color: ACCENT_BRONZE,
              }}
            >
              <Send className="h-4 w-4" aria-hidden />
              Campaigns
            </Button>
          </Link>
          {editable && (
            <Button
              variant="ghost"
              onClick={() => setScanning(true)}
              style={{ backgroundColor: FRAME_RUST, color: CARD_BG, border: "none" }}
            >
              <Radar className="h-4 w-4" aria-hidden />
              Scan company
            </Button>
          )}
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

      {showEmpty ? (
        <EmptyState
          icon={Mail}
          title="No outreach contacts yet"
          description="Scan a company without a giving page to extract emails, contact forms, and key personnel."
          action={
            editable ? (
              <Button
                variant="ghost"
                onClick={() => setScanning(true)}
                style={{ backgroundColor: FRAME_RUST, color: CARD_BG, border: "none" }}
              >
                <Radar className="h-4 w-4" aria-hidden />
                Scan company
              </Button>
            ) : undefined
          }
        />
      ) : (
        <OutreachContactTable
          contacts={contacts}
          isLoading={loading}
          canConvert={editable}
          organizationId={profile?.organization_id ?? null}
          onChanged={load}
        />
      )}

      <ScanModal
        isOpen={scanning}
        onClose={() => setScanning(false)}
        onComplete={async () => {
          setScanning(false);
          await load();
        }}
      />
    </div>
  );
}

/**
 * Triggers the Cold Outreach Agent for a single company. POSTs to the agent
 * route, which authenticates and derives organization_id server-side; this
 * client never sends an organization id.
 */
function ScanModal({
  isOpen,
  onClose,
  onComplete,
}: {
  isOpen: boolean;
  onClose: () => void;
  onComplete: () => void | Promise<void>;
}) {
  const [companyName, setCompanyName] = useState("");
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleScan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (companyName.trim() === "") {
      setError("A company name is required.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/agents/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          companyName: companyName.trim(),
          websiteUrl: websiteUrl.trim() || null,
        }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(
          (payload as { error?: string }).error ??
            "The scan failed. Please try again.",
        );
        setSubmitting(false);
        return;
      }
      setCompanyName("");
      setWebsiteUrl("");
      setSubmitting(false);
      await onComplete();
    } catch {
      setError("The scan could not be reached. Please try again.");
      setSubmitting(false);
    }
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={submitting ? () => undefined : onClose}
      title="Scan a company"
      description="Extract outreach contacts from a company's website."
    >
      <form onSubmit={handleScan} className="space-y-4" noValidate>
        {error && (
          <div
            role="alert"
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
          >
            {error}
          </div>
        )}
        <Input
          label="Company name"
          value={companyName}
          onChange={(e) => setCompanyName(e.target.value)}
          placeholder="Acme Construction"
          required
        />
        <Input
          label="Website"
          value={websiteUrl}
          onChange={(e) => setWebsiteUrl(e.target.value)}
          placeholder="acme.com"
          helperText="Optional, but needed to extract emails and contacts automatically."
        />
        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            isLoading={submitting}
            disabled={companyName.trim() === ""}
          >
            <Radar className="h-4 w-4" aria-hidden />
            Run scan
          </Button>
        </div>
      </form>
    </Modal>
  );
}
