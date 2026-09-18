import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { ThreadLinker } from "@/lib/email/thread-linker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const body = await request.json().catch(() => ({})) as {
    thread_id?: string;
    funder_id?: string;
    contact_id?: string;
    opportunity_id?: string;
    application_id?: string;
    auto?: boolean;
  };

  if (!body.thread_id) {
    return NextResponse.json({ error: "thread_id is required" }, { status: 400 });
  }

  const linker = new ThreadLinker();

  // Bulk auto-link: run autoLinkThread on all unlinked threads for the org.
  if (body.thread_id === "auto") {
    const result = await linker.bulkAutoLink(organizationId);
    return NextResponse.json(result);
  }

  // Per-thread auto-link: the quick "Link" action in the thread list has no
  // funder/contact pre-selected — try the 3-tier matcher for just this thread.
  if (body.auto === true) {
    const result = await linker.autoLinkThread(body.thread_id, organizationId);
    return NextResponse.json(result);
  }

  const supabase = createAdminClient();

  // Manual link: replace any existing link with the caller-supplied values.
  await supabase
    .from("email_thread_links")
    .delete()
    .eq("organization_id", organizationId)
    .eq("thread_id", body.thread_id);

  const { error } = await supabase.from("email_thread_links").insert({
    organization_id: organizationId,
    thread_id: body.thread_id,
    funder_id: body.funder_id ?? null,
    contact_id: body.contact_id ?? null,
    match_type: "manual",
  });

  if (error) {
    return NextResponse.json(
      { error: "Failed to link thread", code: "db_error" },
      { status: 500 },
    );
  }

  return NextResponse.json({ linked: true, method: "manual" });
}
