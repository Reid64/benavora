import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { ContactDetail } from "@/components/contacts/ContactDetail";

/**
 * Contact detail page (BLUEPRINT §4.3). Renders the detail view; all data
 * loading and RLS-scoped reads happen in the client ContactDetail component.
 * The id comes from the route, not from any request body.
 */
export default function ContactDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div className="space-y-6">
      <Link
        href="/contacts"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to contacts
      </Link>
      <ContactDetail contactId={params.id} />
    </div>
  );
}
