"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Brain,
  Building2,
  ExternalLink,
  FileText,
  Inbox,
  KeyRound,
  Mail,
  MessageSquare,
  Pencil,
  Trash2,
  Users,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  LoadingSpinner,
  Modal,
  Textarea,
} from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { FunderForm } from "@/components/funders/FunderForm";
import { ContactForm } from "@/components/contacts/ContactForm";
import { OutreachContactTable } from "@/components/outreach/OutreachContactTable";
import { recordAudit } from "@/lib/audit/client";
import { createClient } from "@/lib/supabase/client";
import { canDeleteFunder, canEdit, useProfile } from "@/lib/hooks/useProfile";
import {
  formatCurrency,
  formatDate,
  formatRelative,
  humanizeEnum,
} from "@/lib/utils/formatters";
import { isNonEmpty } from "@/lib/utils/validators";
import type { Enums, Tables } from "@/types/database";

type TabKey =
  | "overview"
  | "contacts"
  | "outreach"
  | "opportunities"
  | "applications"
  | "notes"
  | "intelligence";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "contacts", label: "Contacts" },
  { key: "outreach", label: "Outreach" },
  { key: "opportunities", label: "Opportunities" },
  { key: "applications", label: "Applications" },
  { key: "notes", label: "Notes" },
  { key: "intelligence", label: "Intelligence" },
];

const RELATIONSHIP_COLOR: Record<
  Enums<"contact_relationship">,
  BadgeColor
> = {
  cold: "gray",
  warm: "yellow",
  active: "blue",
  champion: "green",
};

const STATUS_COLOR: Record<Enums<"opportunity_status">, BadgeColor> = {
  open: "green",
  applied: "blue",
  closed: "gray",
  expired: "red",
};

type RelationshipScore = {
  relationship_score: number;
  trend: "rising" | "falling" | "neutral";
  is_stale: boolean;
} | null;

type FunderData = {
  funder: Tables<"funders">;
  contacts: Tables<"contacts">[];
  opportunities: Tables<"opportunities">[];
  applications: Tables<"applications">[];
  relationshipScore: RelationshipScore;
  notes: Tables<"notes">[];
  intelligence: Tables<"funder_intelligence"> | null;
};

export type FunderDetailProps = {
  funderId: string;
};

/**
 * Tabbed funder detail view (BLUEPRINT §4.2): Overview, Contacts,
 * Opportunities, Applications, Notes. All reads are RLS-scoped to the
 * organization; writes derive organization_id from the session profile.
 */
export function FunderDetail({ funderId }: FunderDetailProps) {
  const router = useRouter();
  const { profile } = useProfile();
  const [data, setData] = useState<FunderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("overview");
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [researching, setResearching] = useState(false);
  const [researchError, setResearchError] = useState<string | null>(null);
  const [extractingHistory, setExtractingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);
    setError(null);

    const { data: funder, error: funderError } = await supabase
      .from("funders")
      .select("*")
      .eq("id", funderId)
      .single();

    if (funderError || !funder) {
      setError("This funder could not be found.");
      setLoading(false);
      return;
    }

    const [contactsRes, opportunitiesRes, notesRes, intelRes, scoreRes] =
      await Promise.all([
        supabase
          .from("contacts")
          .select("*")
          .eq("funder_id", funderId)
          .order("created_at", { ascending: false }),
        supabase
          .from("opportunities")
          .select("*")
          .eq("funder_id", funderId)
          .order("deadline", { ascending: true, nullsFirst: false }),
        supabase
          .from("notes")
          .select("*")
          .eq("funder_id", funderId)
          .order("created_at", { ascending: false }),
        supabase
          .from("funder_intelligence")
          .select("*")
          .eq("funder_id", funderId)
          .maybeSingle(),
        supabase
          .from("funder_relationship_scores")
          .select("relationship_score, trend, is_stale")
          .eq("funder_id", funderId)
          .maybeSingle(),
      ]);

    const opportunities = opportunitiesRes.data ?? [];
    const opportunityIds = opportunities.map((o) => o.id);

    let applications: Tables<"applications">[] = [];
    if (opportunityIds.length > 0) {
      const { data: apps } = await supabase
        .from("applications")
        .select("*")
        .in("opportunity_id", opportunityIds)
        .order("updated_at", { ascending: false });
      applications = apps ?? [];
    }

    const rs = scoreRes.data;
    const relationshipScore: RelationshipScore = rs
      ? {
          relationship_score: rs.relationship_score as number,
          trend: (rs.trend as "rising" | "falling" | "neutral") ?? "neutral",
          is_stale: (rs.is_stale as boolean) ?? false,
        }
      : null;

    setData({
      funder,
      contacts: contactsRes.data ?? [],
      opportunities,
      applications,
      notes: notesRes.data ?? [],
      intelligence: intelRes.data ?? null,
      relationshipScore,
    });
    setLoading(false);
  }, [funderId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleResearch() {
    if (!data) return;
    setResearching(true);
    setResearchError(null);
    try {
      const res = await fetch("/api/agents/funder-intel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funderId }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setResearchError(json.error ?? "Research failed.");
        return;
      }
      await load();
      setTab("intelligence");
    } catch {
      setResearchError("Network error. Please try again.");
    } finally {
      setResearching(false);
    }
  }

  async function handleGivingHistory(ein: string) {
    setExtractingHistory(true);
    setHistoryError(null);
    try {
      const res = await fetch("/api/agents/giving-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funderId, ein }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setHistoryError(json.error ?? "Extraction failed.");
        return;
      }
      await load();
      setTab("intelligence");
    } catch {
      setHistoryError("Network error. Please try again.");
    } finally {
      setExtractingHistory(false);
    }
  }

  async function handleDelete() {
    if (!data) return;
    setDeleting(true);
    const supabase = createClient();
    // Cascade is enforced at the DB (contacts) and FK (opportunities → NULL)
    // per Contracts §3.
    const { error: deleteError } = await supabase
      .from("funders")
      .delete()
      .eq("id", data.funder.id);

    if (deleteError) {
      setError(deleteError.message);
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }
    void recordAudit({ action: "delete", entityType: "funder", entityId: data.funder.id, details: { name: data.funder.name } });
    router.push("/funders");
    router.refresh();
  }

  if (loading) {
    return <LoadingSpinner center label="Loading funder..." />;
  }

  if (error || !data) {
    return (
      <EmptyState
        icon={Building2}
        title="Funder unavailable"
        description={error ?? "This funder could not be found."}
        action={
          <Button variant="secondary" onClick={() => router.push("/funders")}>
            Back to funders
          </Button>
        }
      />
    );
  }

  const { funder } = data;
  const editable = canEdit(profile?.role);
  const deletable = canDeleteFunder(profile?.role);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight text-primary">
              {funder.name}
            </h1>
            <Badge color="indigo">{humanizeEnum(funder.category)}</Badge>
            {funder.has_giving_page === false && (
              <Badge color="yellow">Cold outreach</Badge>
            )}
            {data.relationshipScore && (
              <RelationshipScoreBadge score={data.relationshipScore} />
            )}
            <Link
              href={`/funders/${funderId}/relationship`}
              className="text-sm font-medium text-primary transition hover:underline"
            >
              Relationship Builder
            </Link>
          </div>
          {funder.geographic_focus && (
            <p className="mt-1 text-sm text-navy-500">
              {funder.geographic_focus}
            </p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {editable && (
              <Button
                variant="secondary"
                onClick={() => void handleResearch()}
                isLoading={researching}
                disabled={researching}
              >
                <Brain className="h-4 w-4" aria-hidden />
                Research funder
              </Button>
            )}
            {editable && (
              <Button variant="secondary" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                Edit
              </Button>
            )}
            {deletable && (
              <Button variant="danger" onClick={() => setConfirmDelete(true)}>
                <Trash2 className="h-4 w-4" aria-hidden />
                Delete
              </Button>
            )}
          </div>
          {researchError && (
            <p className="text-sm text-red-600">{researchError}</p>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-navy-200">
        <nav className="-mb-px flex gap-6 overflow-x-auto" aria-label="Tabs">
          {TABS.map((t) => {
            const count =
              t.key === "contacts"
                ? data.contacts.length
                : t.key === "opportunities"
                  ? data.opportunities.length
                  : t.key === "applications"
                    ? data.applications.length
                    : t.key === "notes"
                      ? data.notes.length
                      : null;
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                aria-current={active ? "page" : undefined}
                className={
                  "whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition " +
                  (active
                    ? "border-teal-600 text-teal-600"
                    : "border-transparent text-navy-500 hover:border-navy-300 hover:text-navy-700")
                }
              >
                {t.label}
                {count != null && (
                  <Badge variant={active ? "info" : "neutral"} className="ml-2">
                    {count}
                  </Badge>
                )}
              </button>
            );
          })}
        </nav>
      </div>

      {/* Tab panels */}
      {tab === "overview" && (
        <OverviewTab funder={funder} canEdit={editable} />
      )}
      {tab === "contacts" && (
        <ContactsTab
          funderId={funder.id}
          contacts={data.contacts}
          canAdd={editable}
          onChanged={load}
        />
      )}
      {tab === "outreach" && (
        <OutreachTab
          funderId={funder.id}
          organizationId={profile?.organization_id ?? null}
        />
      )}
      {tab === "opportunities" && (
        <OpportunitiesTab opportunities={data.opportunities} />
      )}
      {tab === "applications" && (
        <ApplicationsTab
          applications={data.applications}
          opportunities={data.opportunities}
        />
      )}
      {tab === "notes" && (
        <NotesTab
          funderId={funder.id}
          notes={data.notes}
          canAdd={editable}
          organizationId={profile?.organization_id ?? null}
          authorId={profile?.id ?? null}
          onAdded={load}
        />
      )}
      {tab === "intelligence" && (
        <IntelligenceTab
          intelligence={data.intelligence}
          onResearch={editable ? () => void handleResearch() : undefined}
          researching={researching}
          onExtractHistory={editable ? handleGivingHistory : undefined}
          extractingHistory={extractingHistory}
          historyError={historyError}
        />
      )}

      {/* Edit modal */}
      <Modal
        isOpen={editing}
        onClose={() => setEditing(false)}
        title="Edit funder"
        size="xl"
      >
        <FunderForm
          funder={funder}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            void load();
          }}
        />
      </Modal>

      {/* Delete confirmation */}
      <Modal
        isOpen={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title="Delete funder"
        description="This cannot be undone."
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => setConfirmDelete(false)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={handleDelete}
              isLoading={deleting}
            >
              Delete funder
            </Button>
          </>
        }
      >
        <p className="text-sm text-navy-600">
          Deleting <span className="font-medium">{funder.name}</span> also
          removes its {data.contacts.length} contact
          {data.contacts.length === 1 ? "" : "s"} and unlinks its{" "}
          {data.opportunities.length} opportunit
          {data.opportunities.length === 1 ? "y" : "ies"}.
        </p>
      </Modal>
    </div>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="py-3">
      <dt className="text-xs font-semibold uppercase tracking-wide text-navy-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-navy-800">{children}</dd>
    </div>
  );
}

function OverviewTab({
  funder,
  canEdit,
}: {
  funder: Tables<"funders">;
  canEdit?: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card title="Details">
        <dl className="divide-y divide-navy-100">
          <DetailRow label="Description">
            {funder.description ?? <span className="text-navy-400">-</span>}
          </DetailRow>
          <DetailRow label="Geographic focus">
            {funder.geographic_focus ?? (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Annual giving budget">
            {formatCurrency(funder.annual_giving_budget)}
          </DetailRow>
          <DetailRow label="Preferred application method">
            {funder.preferred_application_method ? (
              humanizeEnum(funder.preferred_application_method)
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
        </dl>
      </Card>

      <Card title="Portal & links">
        <dl className="divide-y divide-navy-100">
          <DetailRow label="Website">
            {funder.website ? (
              <a
                href={funder.website}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-teal-600 hover:text-teal-700"
              >
                {funder.website}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Giving portal">
            {funder.giving_portal_url ? (
              <a
                href={funder.giving_portal_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-teal-600 hover:text-teal-700"
              >
                {funder.giving_portal_url}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Portal login status">
            {funder.portal_login_status ? (
              humanizeEnum(funder.portal_login_status)
            ) : (
              <span className="text-navy-400">-</span>
            )}
          </DetailRow>
          <DetailRow label="Has giving page">
            {funder.has_giving_page === false ? (
              <Badge color="yellow">No - cold outreach target</Badge>
            ) : (
              <Badge color="green">Yes</Badge>
            )}
          </DetailRow>
          <DetailRow label="Last contacted">
            {funder.last_contacted_at ? (
              formatRelative(funder.last_contacted_at)
            ) : (
              <span className="text-navy-400">Never</span>
            )}
          </DetailRow>
        </dl>
      </Card>

      {funder.notes && (
        <Card title="Notes" className="lg:col-span-2">
          <p className="whitespace-pre-wrap text-sm text-navy-700">
            {funder.notes}
          </p>
        </Card>
      )}

      <div className="lg:col-span-2">
        <PortalLoginSection funderId={funder.id} canEdit={canEdit ?? false} />
      </div>
    </div>
  );
}

function ContactsTab({
  funderId,
  contacts,
  canAdd,
  onChanged,
}: {
  funderId: string;
  contacts: Tables<"contacts">[];
  canAdd: boolean;
  onChanged: () => Promise<void> | void;
}) {
  const [adding, setAdding] = useState(false);

  return (
    <div className="space-y-4">
      {canAdd && (
        <div className="flex justify-end">
          <Button onClick={() => setAdding(true)}>
            <Users className="h-4 w-4" aria-hidden />
            Add contact
          </Button>
        </div>
      )}

      {contacts.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No contacts yet"
          description="People you add at this funder will appear here."
          action={
            canAdd ? (
              <Button onClick={() => setAdding(true)}>Add contact</Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {contacts.map((contact) => (
            <Card key={contact.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-medium text-navy-900">{contact.name}</p>
                  {contact.title && (
                    <p className="text-sm text-navy-500">{contact.title}</p>
                  )}
                </div>
                {contact.relationship && (
                  <Badge color={RELATIONSHIP_COLOR[contact.relationship]}>
                    {humanizeEnum(contact.relationship)}
                  </Badge>
                )}
              </div>
              <dl className="mt-3 space-y-1 text-sm text-navy-600">
                {contact.email && (
                  <div className="truncate">
                    <a
                      href={`mailto:${contact.email}`}
                      className="text-teal-600 hover:text-teal-700"
                    >
                      {contact.email}
                    </a>
                  </div>
                )}
                {contact.phone && <div>{contact.phone}</div>}
              </dl>
            </Card>
          ))}
        </div>
      )}

      <Modal
        isOpen={adding}
        onClose={() => setAdding(false)}
        title="Add contact"
        size="xl"
      >
        <ContactForm
          defaultFunderId={funderId}
          onCancel={() => setAdding(false)}
          onSaved={async () => {
            setAdding(false);
            await onChanged();
          }}
        />
      </Modal>
    </div>
  );
}

function OutreachTab({
  funderId,
  organizationId,
}: {
  funderId: string;
  organizationId: string | null;
}) {
  const [contacts, setContacts] = useState<Tables<"outreach_contacts">[]>([]);
  const [loading, setLoading] = useState(true);

  const loadOutreach = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();
    const { data } = await supabase
      .from("outreach_contacts")
      .select("*")
      .eq("converted_to_funder_id", funderId)
      .order("created_at", { ascending: false });
    setContacts(data ?? []);
    setLoading(false);
  }, [funderId]);

  useEffect(() => {
    void loadOutreach();
  }, [loadOutreach]);

  if (loading) {
    return <LoadingSpinner center label="Loading outreach..." />;
  }

  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={Mail}
        title="No outreach for this funder"
        description="Outreach prospects that were converted into this funder appear here. Scan companies on the Outreach page to extract new prospects."
        action={
          <Link href="/outreach">
            <Button variant="secondary">Open Outreach</Button>
          </Link>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <OutreachContactTable
        contacts={contacts}
        isLoading={false}
        canConvert={false}
        organizationId={organizationId}
        onChanged={loadOutreach}
      />
      <div className="text-right">
        <Link
          href="/outreach"
          className="text-sm font-medium text-teal-600 hover:text-teal-700"
        >
          Open full Outreach →
        </Link>
      </div>
    </div>
  );
}

function OpportunitiesTab({
  opportunities,
}: {
  opportunities: Tables<"opportunities">[];
}) {
  if (opportunities.length === 0) {
    return (
      <EmptyState
        icon={Inbox}
        title="No opportunities"
        description="Funding opportunities linked to this funder will appear here."
      />
    );
  }
  return (
    <div className="space-y-3">
      {opportunities.map((opp) => (
        <Card key={opp.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-navy-900">{opp.name}</p>
              <p className="mt-0.5 text-sm text-navy-500">
                {humanizeEnum(opp.category)}
                {opp.deadline && ` · Due ${formatDate(opp.deadline)}`}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {opp.amount_max != null && (
                <span className="text-sm font-medium text-navy-700">
                  {formatCurrency(opp.amount_max)}
                </span>
              )}
              {opp.status && (
                <Badge color={STATUS_COLOR[opp.status]}>
                  {humanizeEnum(opp.status)}
                </Badge>
              )}
            </div>
          </div>
        </Card>
      ))}
    </div>
  );
}

function ApplicationsTab({
  applications,
  opportunities,
}: {
  applications: Tables<"applications">[];
  opportunities: Tables<"opportunities">[];
}) {
  if (applications.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No applications"
        description="Applications for this funder's opportunities will appear here."
      />
    );
  }
  const oppName = (id: string) =>
    opportunities.find((o) => o.id === id)?.name ?? "Opportunity";
  return (
    <div className="space-y-3">
      {applications.map((app) => (
        <Card key={app.id}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium text-navy-900">
                {oppName(app.opportunity_id)}
              </p>
              <p className="mt-0.5 text-sm text-navy-500">
                Requested {formatCurrency(app.requested_amount)}
              </p>
            </div>
            <Badge color="blue">{humanizeEnum(app.stage)}</Badge>
          </div>
        </Card>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Intelligence tab
// ---------------------------------------------------------------------------

type RecentGrant = {
  recipient?: string;
  amount?: number | null;
  year?: number | null;
  purpose?: string;
};
type BoardMember = { name?: string; title?: string | null };

type GivingHistoryFiling = {
  year: number;
  totalRevenue: number;
  totalAssets: number;
  grantsPaid: number;
};
type GivingHistoryData = {
  source: "propublica";
  ein: string;
  trend: "increasing" | "decreasing" | "stable" | "insufficient_data";
  filings: GivingHistoryFiling[];
};

function IntelligenceTab({
  intelligence,
  onResearch,
  researching,
  onExtractHistory,
  extractingHistory,
  historyError,
}: {
  intelligence: Tables<"funder_intelligence"> | null;
  onResearch?: () => void;
  researching?: boolean;
  onExtractHistory?: (ein: string) => Promise<void>;
  extractingHistory?: boolean;
  historyError?: string | null;
}) {
  if (!intelligence) {
    return (
      <div className="space-y-6">
        <EmptyState
          icon={Brain}
          title="No intelligence yet"
          description="Click Research funder to extract structured intelligence from this funder's website."
          action={
            onResearch ? (
              <Button onClick={onResearch} isLoading={researching}>
                <Brain className="h-4 w-4" aria-hidden />
                Research funder
              </Button>
            ) : undefined
          }
        />
        <GivingHistorySection
          givingHistory={null}
          onExtractHistory={onExtractHistory}
          extractingHistory={extractingHistory}
          historyError={historyError}
        />
      </div>
    );
  }

  const recentGrants = Array.isArray(intelligence.recent_grants)
    ? (intelligence.recent_grants as unknown as RecentGrant[])
    : [];
  const boardMembers = Array.isArray(intelligence.board_members)
    ? (intelligence.board_members as unknown as BoardMember[])
    : [];

  const rawGh = intelligence.recent_grants;
  const givingHistory: GivingHistoryData | null =
    rawGh !== null &&
    rawGh !== undefined &&
    typeof rawGh === "object" &&
    !Array.isArray(rawGh) &&
    (rawGh as Record<string, unknown>).source === "propublica"
      ? (rawGh as unknown as GivingHistoryData)
      : null;

  return (
    <div className="space-y-6">
      {intelligence.last_scraped_at && (
        <p className="text-xs text-navy-400">
          Last researched {formatRelative(intelligence.last_scraped_at)}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Priorities */}
        <Card title="Funding priorities">
          {intelligence.priorities && intelligence.priorities.length > 0 ? (
            <ul className="space-y-1">
              {intelligence.priorities.map((p, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-navy-700">
                  <span className="mt-0.5 text-teal-500">•</span>
                  {p}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-navy-400">Not identified.</p>
          )}
        </Card>

        {/* Key stats */}
        <Card title="Giving stats">
          <dl className="divide-y divide-navy-100">
            <DetailRow label="Average grant size">
              {formatCurrency(intelligence.average_grant_size)}
            </DetailRow>
            <DetailRow label="Total annual giving">
              {formatCurrency(intelligence.total_annual_giving)}
            </DetailRow>
            <DetailRow label="Funding cycles">
              {intelligence.funding_cycles ?? (
                <span className="text-navy-400">-</span>
              )}
            </DetailRow>
          </dl>
        </Card>

        {/* Review criteria */}
        {intelligence.review_criteria && (
          <Card title="Review criteria">
            <p className="whitespace-pre-wrap text-sm text-navy-700">
              {intelligence.review_criteria}
            </p>
          </Card>
        )}

        {/* Application tips */}
        {intelligence.application_tips && (
          <Card title="Application tips">
            <p className="whitespace-pre-wrap text-sm text-navy-700">
              {intelligence.application_tips}
            </p>
          </Card>
        )}
      </div>

      {/* Recent grants */}
      {recentGrants.length > 0 && (
        <Card title="Recent grants">
          <div className="space-y-2">
            {recentGrants.map((g, i) => (
              <div
                key={i}
                className="flex flex-wrap items-start justify-between gap-2 border-b border-navy-100 py-2 last:border-0"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-navy-800">
                    {g.recipient ?? "Unknown recipient"}
                  </p>
                  {g.purpose && (
                    <p className="text-xs text-navy-500">{g.purpose}</p>
                  )}
                </div>
                <div className="flex items-center gap-3 text-sm text-navy-600">
                  {g.amount != null && (
                    <span className="font-medium">{formatCurrency(g.amount)}</span>
                  )}
                  {g.year != null && (
                    <span className="text-navy-400">{g.year}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Board members */}
      {boardMembers.length > 0 && (
        <Card title="Board members">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {boardMembers.map((m, i) => (
              <div key={i} className="text-sm">
                <p className="font-medium text-navy-800">{m.name}</p>
                {m.title && <p className="text-navy-500">{m.title}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Giving History (ProPublica 990-PF) */}
      <GivingHistorySection
        givingHistory={givingHistory}
        onExtractHistory={onExtractHistory}
        extractingHistory={extractingHistory}
        historyError={historyError}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Giving History section (IRS 990-PF via ProPublica)
// ---------------------------------------------------------------------------

const TREND_LABEL: Record<GivingHistoryData["trend"], string> = {
  increasing: "Increasing",
  decreasing: "Decreasing",
  stable: "Stable",
  insufficient_data: "Insufficient data",
};

const TREND_COLOR: Record<GivingHistoryData["trend"], string> = {
  increasing: "text-green-600",
  decreasing: "text-red-600",
  stable: "text-navy-500",
  insufficient_data: "text-navy-400",
};

const TREND_ICON: Record<
  GivingHistoryData["trend"],
  typeof ArrowUp
> = {
  increasing: ArrowUp,
  decreasing: ArrowDown,
  stable: ArrowRight,
  insufficient_data: ArrowRight,
};

function GivingHistorySection({
  givingHistory,
  onExtractHistory,
  extractingHistory,
  historyError,
}: {
  givingHistory: GivingHistoryData | null;
  onExtractHistory?: (ein: string) => Promise<void>;
  extractingHistory?: boolean;
  historyError?: string | null;
}) {
  const [ein, setEin] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLocalError(null);
    const cleaned = ein.replace(/\D/g, "");
    if (cleaned.length !== 9) {
      setLocalError("Enter the 9-digit EIN (e.g. 12-3456789).");
      return;
    }
    if (onExtractHistory) {
      await onExtractHistory(ein.trim());
      setShowForm(false);
    }
  }

  const einForm = onExtractHistory && (
    <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
      <div className="flex-1" style={{ minWidth: "200px" }}>
        <Input
          label="EIN"
          value={ein}
          onChange={(e) => setEin(e.target.value)}
          placeholder="12-3456789"
        />
      </div>
      <Button
        type="submit"
        isLoading={extractingHistory}
        disabled={extractingHistory || ein.trim() === ""}
      >
        Extract
      </Button>
      {givingHistory && (
        <Button
          type="button"
          variant="secondary"
          onClick={() => setShowForm(false)}
          disabled={extractingHistory}
        >
          Cancel
        </Button>
      )}
    </form>
  );

  if (givingHistory) {
    const TrendIcon = TREND_ICON[givingHistory.trend];
    const trendColor = TREND_COLOR[givingHistory.trend];
    const filings = givingHistory.filings ?? [];

    return (
      <Card title="Giving History (IRS 990-PF)">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className={`flex items-center gap-1 text-sm font-medium ${trendColor}`}>
            <TrendIcon className="h-4 w-4" aria-hidden />
            {TREND_LABEL[givingHistory.trend]}
          </div>
          <span className="text-xs text-navy-400">
            EIN {givingHistory.ein.replace(/^(\d{2})(\d{7})$/, "$1-$2")}
          </span>
          {onExtractHistory && !showForm && (
            <button
              type="button"
              className="ml-auto text-xs text-teal-600 underline hover:text-teal-700"
              onClick={() => { setEin(""); setShowForm(true); }}
            >
              Re-extract
            </button>
          )}
        </div>

        {filings.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-sidebar">
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-white">
                  <th className="py-2 pr-4">Year</th>
                  <th className="py-2 pr-4">Grants Paid</th>
                  <th className="py-2 pr-4">Total Revenue</th>
                  <th className="py-2">Total Assets</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-navy-50">
                {filings.map((f) => (
                  <tr key={f.year}>
                    <td className="py-2 pr-4 font-medium text-navy-800">
                      {f.year}
                    </td>
                    <td className="py-2 pr-4 text-navy-700">
                      {formatCurrency(f.grantsPaid)}
                    </td>
                    <td className="py-2 pr-4 text-navy-600">
                      {formatCurrency(f.totalRevenue)}
                    </td>
                    <td className="py-2 text-navy-600">
                      {formatCurrency(f.totalAssets)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-navy-400">No filing data available.</p>
        )}

        {showForm && <div className="mt-4 border-t border-navy-100 pt-4">{einForm}</div>}

        {(localError ?? historyError) && (
          <p className="mt-2 text-sm text-red-600">{localError ?? historyError}</p>
        )}

        <p className="mt-3 text-xs text-navy-400">
          Source: ProPublica Nonprofit Explorer (IRS 990-PF)
        </p>
      </Card>
    );
  }

  return (
    <Card title="Giving History (IRS 990-PF)">
      <p className="mb-4 text-sm text-navy-500">
        Extract annual giving stats from IRS 990-PF filings via ProPublica.
        Enter the organization&apos;s EIN to retrieve up to 3 years of data.
      </p>

      {einForm}

      {(localError ?? historyError) && (
        <p className="mt-2 text-sm text-red-600">
          {localError ?? historyError}
        </p>
      )}

      {!onExtractHistory && (
        <p className="text-sm text-navy-400">No giving history extracted yet.</p>
      )}
    </Card>
  );
}

function NotesTab({
  funderId,
  notes,
  canAdd,
  organizationId,
  authorId,
  onAdded,
}: {
  funderId: string;
  notes: Tables<"notes">[];
  canAdd: boolean;
  organizationId: string | null;
  authorId: string | null;
  onAdded: () => Promise<void> | void;
}) {
  const [content, setContent] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);

  async function handleAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNoteError(null);
    if (!isNonEmpty(content)) return;
    if (!organizationId) {
      setNoteError("Your session could not be verified.");
      return;
    }

    setSubmitting(true);
    const supabase = createClient();
    const nowIso = new Date().toISOString();

    const { error: insertError } = await supabase.from("notes").insert({
      organization_id: organizationId,
      funder_id: funderId,
      author_id: authorId,
      content: content.trim(),
    });

    if (insertError) {
      setNoteError(insertError.message);
      setSubmitting(false);
      return;
    }

    // Contracts §3: adding a note bumps the funder's last_contacted_at.
    await supabase
      .from("funders")
      .update({ last_contacted_at: nowIso })
      .eq("id", funderId);

    // Best-effort: fire note_added relationship event (Agent 23).
    void fetch("/api/agents/funder-relationship", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ funderId, event: "note_added" }),
    }).catch(() => undefined);

    setContent("");
    setSubmitting(false);
    await onAdded();
  }

  return (
    <div className="space-y-5">
      {canAdd && (
        <Card>
          <form onSubmit={handleAdd} className="space-y-3" noValidate>
            {noteError && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
              >
                {noteError}
              </div>
            )}
            <Textarea
              label="Add a note"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="Log a call, an email, or any context about this funder."
              rows={3}
            />
            <div className="flex justify-end">
              <Button
                type="submit"
                isLoading={submitting}
                disabled={!isNonEmpty(content)}
              >
                Add note
              </Button>
            </div>
          </form>
        </Card>
      )}

      {notes.length === 0 ? (
        <EmptyState
          icon={MessageSquare}
          title="No notes yet"
          description={
            canAdd
              ? "Add the first note above."
              : "Notes about this funder will appear here."
          }
        />
      ) : (
        <ul className="space-y-3">
          {notes.map((note) => (
            <li key={note.id}>
              <Card>
                <p className="whitespace-pre-wrap text-sm text-navy-700">
                  {note.content}
                </p>
                <p className="mt-2 text-xs text-navy-400">
                  {formatRelative(note.created_at)}
                  {note.updated_at !== note.created_at && " · edited"}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Portal Login section
// ---------------------------------------------------------------------------

type CredentialState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "saved"; username: string }
  | { status: "error"; message: string };

function PortalLoginSection({
  funderId,
  canEdit,
}: {
  funderId: string;
  canEdit: boolean;
}) {
  const [credState, setCredState] = useState<CredentialState>({
    status: "loading",
  });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const loadCredentials = useCallback(async () => {
    setCredState({ status: "loading" });
    try {
      const res = await fetch(
        `/api/automation/portal-credentials?funderId=${encodeURIComponent(funderId)}`,
      );
      if (!res.ok) {
        setCredState({ status: "error", message: "Failed to load credentials." });
        return;
      }
      const json = (await res.json()) as {
        hasCredentials: boolean;
        username: string | null;
      };
      setCredState(
        json.hasCredentials
          ? { status: "saved", username: json.username ?? "" }
          : { status: "none" },
      );
    } catch {
      setCredState({ status: "error", message: "Network error." });
    }
  }, [funderId]);

  useEffect(() => {
    void loadCredentials();
  }, [loadCredentials]);

  async function handleSave(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setFormError(null);
    if (!username.trim() || !password) {
      setFormError("Username and password are required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/automation/portal-credentials", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ funderId, username: username.trim(), password }),
      });
      if (!res.ok) {
        const json = (await res.json()) as { error?: string };
        setFormError(json.error ?? "Failed to save credentials.");
        return;
      }
      setPassword("");
      setEditing(false);
      await loadCredentials();
    } catch {
      setFormError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await fetch(
        `/api/automation/portal-credentials?funderId=${encodeURIComponent(funderId)}`,
        { method: "DELETE" },
      );
      setEditing(false);
      setUsername("");
      setPassword("");
      await loadCredentials();
    } catch {
      // ignore
    } finally {
      setDeleting(false);
    }
  }

  if (credState.status === "loading") {
    return (
      <Card title="Portal login">
        <LoadingSpinner label="Loading..." />
      </Card>
    );
  }

  const showForm =
    canEdit && (credState.status === "none" || editing);

  return (
    <Card title="Portal login">
      {credState.status === "saved" && !editing && (
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-sm text-navy-700">
            <KeyRound className="h-4 w-4 text-teal-600" aria-hidden />
            <span>
              Credentials saved for{" "}
              <span className="font-medium">{credState.username}</span>
            </span>
          </div>
          {canEdit && (
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setUsername(credState.username);
                  setPassword("");
                  setFormError(null);
                  setEditing(true);
                }}
              >
                Update
              </Button>
              <Button
                variant="danger"
                onClick={handleDelete}
                isLoading={deleting}
                disabled={deleting}
              >
                Remove
              </Button>
            </div>
          )}
        </div>
      )}

      {credState.status === "error" && (
        <p className="text-sm text-red-600">{credState.message}</p>
      )}

      {showForm && (
        <form onSubmit={handleSave} className="space-y-4" noValidate>
          {formError && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
            >
              {formError}
            </div>
          )}
          <p className="text-sm text-navy-500">
            Credentials are encrypted and used only for automated portal login.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Username / email"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="portal@example.com"
              autoComplete="username"
            />
            <Input
              label="Password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="current-password"
            />
          </div>
          <div className="flex justify-end gap-2">
            {editing && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setEditing(false);
                  setFormError(null);
                }}
              >
                Cancel
              </Button>
            )}
            <Button type="submit" isLoading={saving} disabled={saving}>
              Save credentials
            </Button>
          </div>
        </form>
      )}

      {!canEdit && credState.status === "none" && (
        <p className="text-sm text-navy-400">No portal credentials saved.</p>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Relationship score badge (Agent 23)
// ---------------------------------------------------------------------------

function RelationshipScoreBadge({ score }: { score: RelationshipScore }) {
  if (!score) return null;

  const { relationship_score, trend, is_stale } = score;

  const TrendIcon =
    trend === "rising"
      ? ArrowUp
      : trend === "falling"
        ? ArrowDown
        : ArrowRight;

  const trendColor =
    trend === "rising"
      ? "text-green-600"
      : trend === "falling"
        ? "text-red-600"
        : "text-navy-400";

  return (
    <div className="flex items-center gap-1.5 rounded-full border border-navy-200 bg-white px-3 py-1 text-sm">
      <span className="font-semibold text-navy-800">{relationship_score}</span>
      <span className="text-navy-400">/100</span>
      <TrendIcon className={`h-3.5 w-3.5 ${trendColor}`} aria-hidden />
      {is_stale && (
        <Badge variant="warning" className="ml-1 px-1.5">
          stale
        </Badge>
      )}
    </div>
  );
}
