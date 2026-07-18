import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { FUNDING_SOURCES } from "@/lib/sources/funding-source-registry";
import { createClient } from "@/lib/supabase/server";

// GET /api/sources/registry — returns the full funding source catalog
// (FUNDING_SOURCES). Seeds the shared, non-org-scoped `funding_sources`
// table (migration 097) from that catalog on first call if it's empty.
//
// The seed insert is gated on an authenticated caller with an org context
// (x-organization-id header — same lightweight pattern as /api/nav-counts)
// so an anonymous request can't trigger it; the table has no RLS since it's
// a shared catalog, not org data, so there is nothing else to scope by.

export const runtime = "nodejs";

export async function GET() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const orgId = headers().get("x-organization-id");

  if (user && orgId) {
    const { count } = await supabase
      .from("funding_sources")
      .select("id", { count: "exact", head: true });

    if (!count) {
      await supabase.from("funding_sources").insert(
        FUNDING_SOURCES.map((source) => ({
          name: source.name,
          category: source.category,
          source_type: source.source_type,
          website_url: source.website_url ?? null,
          api_url: source.api_url ?? null,
          adapter_type: source.adapter_type,
        })),
      );
    }
  }

  return NextResponse.json({ sources: FUNDING_SOURCES });
}
