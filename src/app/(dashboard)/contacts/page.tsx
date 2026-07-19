"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";

import { Button, EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  ContactTable,
  type ContactRow,
} from "@/components/contacts/ContactTable";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

/**
 * Contact list (BLUEPRINT §4.3). Reads are RLS-scoped to the organization, so
 * no organization_id filter is needed client-side - the policy enforces it.
 * Each contact is joined to its funder's name for display and search.
 */
export default function ContactsPage() {
  const { profile } = useProfile();
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createClient();

    (async () => {
      setLoading(true);
      setError(null);

      const [contactsRes, fundersRes] = await Promise.all([
        supabase
          .from("contacts")
          .select("*")
          .order("name", { ascending: true })
          .limit(1000),
        supabase.from("funders").select("id, name"),
      ]);

      if (!active) return;

      if (contactsRes.error) {
        setError("Could not load contacts.");
        setLoading(false);
        return;
      }

      const funderNames = new Map<string, string>();
      for (const funder of fundersRes.data ?? []) {
        funderNames.set(funder.id, funder.name);
      }

      const rows: ContactRow[] = (contactsRes.data ?? []).map((contact) => ({
        ...contact,
        funderName: funderNames.get(contact.funder_id) ?? "Unknown funder",
      }));

      setContacts(rows);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, []);

  const editable = canEdit(profile?.role);
  const showEmpty = !loading && !error && contacts.length === 0;

  return (
    <div className="min-h-screen space-y-6 bg-[#EEF2F7] p-6 page-bg">
      <PageHeader
        title="Contacts"
        description="People at your funders, with relationship status at a glance."
        actions={
          editable && (
            <Link href="/contacts/new">
              <Button>
                <Plus className="h-4 w-4" aria-hidden />
                New contact
              </Button>
            </Link>
          )
        }
      />

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
          icon={Users}
          title="No contacts yet"
          description="Add your first contact and link it to a funder to start tracking relationships."
          action={
            editable ? (
              <Link href="/contacts/new">
                <Button>
                  <Plus className="h-4 w-4" aria-hidden />
                  New contact
                </Button>
              </Link>
            ) : undefined
          }
        />
      ) : (
        <ContactTable contacts={contacts} isLoading={loading} />
      )}
    </div>
  );
}
