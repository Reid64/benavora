"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Building2,
  Mail,
  Pencil,
  Phone,
  Trash2,
  Users,
} from "lucide-react";

import {
  Badge,
  Button,
  Card,
  EmptyState,
  LoadingSpinner,
  Modal,
  Select,
} from "@/components/ui";
import { ContactForm } from "@/components/contacts/ContactForm";
import { RELATIONSHIP_COLOR } from "@/components/contacts/ContactTable";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { CONTACT_RELATIONSHIPS } from "@/lib/utils/constants";
import { formatDate, formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type ContactRelationship = Enums<"contact_relationship">;

const RELATIONSHIP_OPTIONS = CONTACT_RELATIONSHIPS.map((value) => ({
  value,
  label: humanizeEnum(value),
}));

type ContactData = {
  contact: Tables<"contacts">;
  funder: Pick<Tables<"funders">, "id" | "name"> | null;
};

export type ContactDetailProps = {
  contactId: string;
};

/**
 * Contact detail view (BLUEPRINT §4.3). Shows the contact's details, the funder
 * it's linked to, and an inline relationship-status control. All reads are
 * RLS-scoped to the organization; writes derive organization_id from the
 * session profile.
 */
export function ContactDetail({ contactId }: ContactDetailProps) {
  const router = useRouter();
  const { profile } = useProfile();
  const [data, setData] = useState<ContactData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [updatingRelationship, setUpdatingRelationship] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);
    setError(null);

    const { data: contact, error: contactError } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", contactId)
      .single();

    if (contactError || !contact) {
      setError("This contact could not be found.");
      setLoading(false);
      return;
    }

    const { data: funder } = await supabase
      .from("funders")
      .select("id, name")
      .eq("id", contact.funder_id)
      .single();

    setData({ contact, funder: funder ?? null });
    setLoading(false);
  }, [contactId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Relationship update (Behavioral Contracts §4). This control is a manual
  // override, so any transition is permitted - not just forward progression.
  async function handleRelationshipChange(next: ContactRelationship) {
    if (!data || next === data.contact.relationship) return;
    setUpdatingRelationship(true);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("contacts")
      .update({ relationship: next })
      .eq("id", data.contact.id);

    setUpdatingRelationship(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    await load();
  }

  async function handleDelete() {
    if (!data) return;
    setDeleting(true);
    const supabase = createClient();
    const { error: deleteError } = await supabase
      .from("contacts")
      .delete()
      .eq("id", data.contact.id);

    if (deleteError) {
      setError(deleteError.message);
      setDeleting(false);
      setConfirmDelete(false);
      return;
    }
    router.push("/contacts");
    router.refresh();
  }

  if (loading) {
    return <LoadingSpinner center label="Loading contact…" />;
  }

  if (error && !data) {
    return (
      <EmptyState
        icon={Users}
        title="Contact unavailable"
        description={error ?? "This contact could not be found."}
        action={
          <Button variant="secondary" onClick={() => router.push("/contacts")}>
            Back to contacts
          </Button>
        }
      />
    );
  }

  if (!data) return null;

  const { contact, funder } = data;
  const editable = canEdit(profile?.role);
  // Contracts §4 restricts writers from deleting funders, not contacts, so any
  // editing role may remove a contact.
  const deletable = editable;

  return (
    <div className="space-y-6">
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
              {contact.name}
            </h1>
            {contact.relationship && (
              <Badge color={RELATIONSHIP_COLOR[contact.relationship]}>
                {humanizeEnum(contact.relationship)}
              </Badge>
            )}
          </div>
          {contact.title && (
            <p className="mt-1 text-sm text-navy-500">{contact.title}</p>
          )}
          {funder && (
            <p className="mt-1 inline-flex items-center gap-1.5 text-sm text-navy-500">
              <Building2 className="h-4 w-4 text-navy-400" aria-hidden />
              <Link
                href={`/funders/${funder.id}`}
                className="text-teal-600 hover:text-teal-700"
              >
                {funder.name}
              </Link>
            </p>
          )}
        </div>
        {(editable || deletable) && (
          <div className="flex shrink-0 items-center gap-2">
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
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card title="Contact details">
          <dl className="divide-y divide-navy-100">
            <DetailRow label="Email">
              {contact.email ? (
                <a
                  href={`mailto:${contact.email}`}
                  className="inline-flex items-center gap-1.5 text-teal-600 hover:text-teal-700"
                >
                  <Mail className="h-4 w-4" aria-hidden />
                  {contact.email}
                </a>
              ) : (
                <span className="text-navy-400">-</span>
              )}
            </DetailRow>
            <DetailRow label="Phone">
              {contact.phone ? (
                <a
                  href={`tel:${contact.phone}`}
                  className="inline-flex items-center gap-1.5 text-teal-600 hover:text-teal-700"
                >
                  <Phone className="h-4 w-4" aria-hidden />
                  {contact.phone}
                </a>
              ) : (
                <span className="text-navy-400">-</span>
              )}
            </DetailRow>
            <DetailRow label="Preferred contact method">
              {contact.preferred_contact_method ? (
                humanizeEnum(contact.preferred_contact_method)
              ) : (
                <span className="text-navy-400">-</span>
              )}
            </DetailRow>
            <DetailRow label="Last contacted">
              {contact.last_contacted_at ? (
                formatDate(contact.last_contacted_at)
              ) : (
                <span className="text-navy-400">Never</span>
              )}
            </DetailRow>
          </dl>
        </Card>

        <Card title="Relationship">
          <p className="text-sm text-navy-500">
            Track how this relationship is progressing: cold → warm → active →
            champion.
          </p>
          <div className="mt-4 max-w-xs">
            <Select
              label="Relationship status"
              options={RELATIONSHIP_OPTIONS}
              value={contact.relationship ?? "cold"}
              disabled={!editable || updatingRelationship}
              onChange={(e) =>
                void handleRelationshipChange(
                  e.target.value as ContactRelationship,
                )
              }
              helperText={
                editable
                  ? "Changing this is a manual override."
                  : "You have read-only access."
              }
            />
          </div>
        </Card>

        {contact.notes && (
          <Card title="Notes" className="lg:col-span-2">
            <p className="whitespace-pre-wrap text-sm text-navy-700">
              {contact.notes}
            </p>
          </Card>
        )}
      </div>

      <p className="text-xs text-navy-400">
        Added {formatRelative(contact.created_at)}
        {contact.updated_at !== contact.created_at &&
          ` · updated ${formatRelative(contact.updated_at)}`}
      </p>

      {/* Edit modal */}
      <Modal
        isOpen={editing}
        onClose={() => setEditing(false)}
        title="Edit contact"
        size="xl"
      >
        <ContactForm
          contact={contact}
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
        title="Delete contact"
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
            <Button variant="danger" onClick={handleDelete} isLoading={deleting}>
              Delete contact
            </Button>
          </>
        }
      >
        <p className="text-sm text-navy-600">
          Deleting <span className="font-medium">{contact.name}</span> removes
          this contact permanently.
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
