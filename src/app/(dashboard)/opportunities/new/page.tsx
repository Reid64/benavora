import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card } from "@/components/ui";
import { OpportunityForm } from "@/components/opportunities/OpportunityForm";

/**
 * Create-opportunity page (BLUEPRINT §4.4). The form derives organization_id
 * from the session profile, stores keywords in opportunity_keywords, and
 * redirects to the new opportunity's detail page on save.
 */
export default function NewOpportunityPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/opportunities"
          className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to opportunities
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-primary">
          New opportunity
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Add a grant, donation program, or sponsorship to track.
        </p>
      </div>

      <Card>
        <OpportunityForm />
      </Card>
    </div>
  );
}
