import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ThreadLinkRow = {
  thread_id: string;
  funder_id: string | null;
  contact_id: string | null;
  outreach_contact_id: string | null;
  match_type: string;
};

export async function GET(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const { searchParams } = new URL(request.url);
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const search = searchParams.get("search") ?? "";
  const filter = searchParams.get("filter") ?? "all";
  const pageSize = 25;
  const from = (page - 1) * pageSize;

  const supabase = createAdminClient();

  let query = supabase
    .from("synced_email_threads")
    .select("*", { count: "exact" })
    .eq("organization_id", organizationId)
    .order("last_message_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (search) {
    query = query.or(`subject.ilike.%${search}%,snippet.ilike.%${search}%`);
  }

  const { data: threads, count, error } = await query;
  if (error) {
    return NextResponse.json({ error: "Failed to load threads" }, { status: 500 });
  }

  const threadList = threads ?? [];
  const threadIds = threadList.map((t) => t.id);

  const { data: links } = threadIds.length
    ? await supabase
        .from("email_thread_links")
        .select("thread_id, funder_id, contact_id, outreach_contact_id, match_type")
        .in("thread_id", threadIds)
    : { data: [] };

  const linksByThread = new Map<string, ThreadLinkRow>();
  for (const link of links ?? []) {
    if (link) linksByThread.set(link.thread_id, link as ThreadLinkRow);
  }

  let result = threadList.map((thread) => ({
    ...thread,
    link: linksByThread.get(thread.id) ?? null,
  }));

  if (filter === "linked") {
    result = result.filter((t) => t.link !== null);
  } else if (filter === "unlinked") {
    result = result.filter((t) => t.link === null);
  }

  return NextResponse.json({
    threads: result,
    total: count ?? 0,
    page,
    pageSize,
  });
}
