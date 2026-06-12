import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card } from "@/components/ui";
import { ContactForm } from "@/components/contacts/ContactForm";

/**
 * Create-contact page (BLUEPRINT §4.3). The form derives organization_id from
 * the session profile and redirects to the new contact's detail page on save.
 * An optional `?funder=<id>` query param pre-selects the linked funder.
 */
export default function NewContactPage({
  searchParams,
}: {
  searchParams: { funder?: string };
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/contacts"
          className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to contacts
        </Link>
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-navy-900">
          New contact
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Add a person at one of your funders and track the relationship.
        </p>
      </div>

      <Card>
        <ContactForm defaultFunderId={searchParams.funder} />
      </Card>
    </div>
  );
}
