import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { OpportunityDetail } from "@/components/opportunities/OpportunityDetail";

/**
 * Opportunity detail page (BLUEPRINT §4.4). Renders the tabbed detail view; all
 * data loading and RLS-scoped reads happen in the client OpportunityDetail
 * component. The id comes from the route, not from any request body.
 */
export default function OpportunityDetailPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div style={{ minHeight: "100vh", backgroundColor: "#D6E4F0", padding: "24px" }}>
      <Link
        href="/opportunities"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          marginBottom: "16px",
          fontSize: "14px",
          fontWeight: 600,
          color: "#0F172A",
          textDecoration: "none",
        }}
      >
        <ArrowLeft style={{ height: "16px", width: "16px" }} aria-hidden />
        Back to opportunities
      </Link>
      <OpportunityDetail opportunityId={params.id} />
    </div>
  );
}
