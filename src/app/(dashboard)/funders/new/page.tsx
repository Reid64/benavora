import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { Card } from "@/components/ui";
import { FunderForm } from "@/components/funders/FunderForm";

/**
 * Create-funder page (BLUEPRINT §4.2). The form derives organization_id from
 * the session profile and redirects to the new funder's detail page on save.
 */
export default function NewFunderPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <Link
          href="/funders"
          className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Back to funders
        </Link>
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-primary">
          New funder
        </h1>
        <p className="mt-1 text-sm text-navy-500">
          Add a corporation, foundation, or agency to track for funding.
        </p>
      </div>

      <Card>
        <FunderForm />
      </Card>
    </div>
  );
}
