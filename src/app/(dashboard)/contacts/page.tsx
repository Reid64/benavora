"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";

import { EmptyState } from "@/components/ui";
import { PageHeader } from "@/components/layout/PageHeader";
import {
  ContactTable,
  type ContactRow,
} from "@/components/contacts/ContactTable";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";

// Research & Discovery section signature accent — see
// governance/DESIGN_SYSTEM.md "Section Accent Colors" and
// src/lib/design/section-accents.ts.
const SECTION_ACCENT = "#0284C7";
// Fixed bright teal — reserved for primary action buttons across every
// section, per PAGE_TREATMENT_PROTOCOL.md. Dark text for contrast, matching
// the precedent set on /research and /foundations.
const CTA_TEAL_BG = "#22D3EE";
const CTA_TEAL_TEXT = "#0A1628";

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
    <div style={{ backgroundColor: "#D6E4F0", minHeight: "100vh" }} className="space-y-6 p-6">
      <PageHeader
        title="Contacts"
        accent={SECTION_ACCENT}
        description="People at your funders, with relationship status at a glance."
        actions={
          editable && (
            <Link
              href="/contacts/new"
              style={{ backgroundColor: CTA_TEAL_BG, color: CTA_TEAL_TEXT }}
              className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:brightness-95"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New contact
            </Link>
          )
        }
      />

      {error && (
        <div
          role="alert"
          style={{ border: "1px solid #FECACA", backgroundColor: "#FEF2F2", color: "#B91C1C" }}
          className="rounded-lg px-4 py-3 text-sm"
        >
          {error}
        </div>
      )}

      {showEmpty ? (
        <div
          style={{ backgroundColor: "#FFFFFF", borderRadius: "16px", boxShadow: "0 4px 20px rgba(0,0,0,0.08)" }}
          className="p-10"
        >
          <EmptyState
            icon={Users}
            title="No contacts yet"
            description="Add your first contact and link it to a funder to start tracking relationships."
            action={
              editable ? (
                <Link
                  href="/contacts/new"
                  style={{ backgroundColor: CTA_TEAL_BG, color: CTA_TEAL_TEXT }}
                  className="flex items-center gap-2 rounded-lg px-5 py-2.5 text-sm font-semibold shadow-sm transition-colors hover:brightness-95"
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  New contact
                </Link>
              ) : undefined
            }
          />
        </div>
      ) : (
        <ContactTable contacts={contacts} isLoading={loading} />
      )}
    </div>
  );
}
