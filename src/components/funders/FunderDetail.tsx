"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import {
  Brain,
  Building2,
  ExternalLink,
  FileText,
  Inbox,
  KeyRound,
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
  | "opportunities"
  | "applications"
  | "notes"
  | "intelligence";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "contacts", label: "Contacts" },
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

type FunderData = {
  funder: Tables<"funders">;
  contacts: Tables<"contacts">[];
  opportunities: Tables<"opportunities">[];
  applications: Tables<"applications">[];
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

    const [contactsRes, opportunitiesRes, notesRes, intelRes] =
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

    setData({
      funder,
      contacts: contactsRes.data ?? [],
      opportunities,
      applications,
      notes: notesRes.data ?? [],
      intelligence: intelRes.data ?? null,
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
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
              {funder.name}
            </h1>
            <Badge color="indigo">{humanizeEnum(funder.category)}</Badge>
            {funder.has_giving_page === false && (
              <Badge color="yellow">Cold outreach</Badge>
            )}
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
                  <span
                    className={
                      "ml-2 rounded-full px-2 py-0.5 text-xs " +
                      (active
                        ? "bg-teal-100 text-teal-700"
                        : "bg-navy-100 text-navy-600")
                    }
                  >
                    {count}
                  </span>
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
      {tab === "contacts" && <ContactsTab contacts={data.contacts} />}
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

function ContactsTab({ contacts }: { contacts: Tables<"contacts">[] }) {
  if (contacts.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title="No contacts yet"
        description="People you add at this funder will appear here."
      />
    );
  }
  return (
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

function IntelligenceTab({
  intelligence,
  onResearch,
  researching,
}: {
  intelligence: Tables<"funder_intelligence"> | null;
  onResearch?: () => void;
  researching?: boolean;
}) {
  if (!intelligence) {
    return (
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
    );
  }

  const recentGrants = Array.isArray(intelligence.recent_grants)
    ? (intelligence.recent_grants as unknown as RecentGrant[])
    : [];
  const boardMembers = Array.isArray(intelligence.board_members)
    ? (intelligence.board_members as unknown as BoardMember[])
    : [];

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
    </div>
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
