import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { ProspectManager } from "@/lib/admin/prospect-manager";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const { searchParams } = new URL(request.url);
  const listId = searchParams.get("list_id");
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
  const perPage = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("per_page") ?? "25", 10) || 25),
  );
  const offset = (page - 1) * perPage;

  const supabase = createAdminClient();
  let query = supabase
    .from("prospects")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(offset, offset + perPage - 1);

  if (listId) query = query.eq("list_id", listId);

  const stateFilter = searchParams.get("state");
  if (stateFilter) query = query.eq("state", stateFilter);

  const hasEmail = searchParams.get("has_email");
  if (hasEmail === "true") query = query.not("email", "is", null);

  const suppressedParam = searchParams.get("suppressed");
  if (suppressedParam !== null)
    query = query.eq("suppressed", suppressedParam === "true");

  const { data, error, count } = await query;

  if (error) {
    return NextResponse.json(
      { error: "Failed to load prospects.", code: "load_failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    prospects: data ?? [],
    pagination: {
      page,
      per_page: perPage,
      total: count ?? 0,
      pages: Math.ceil((count ?? 0) / perPage),
    },
  });
}

export async function POST(request: Request) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data.", code: "bad_request" },
      { status: 400 },
    );
  }

  const fileEntry = formData.get("file");
  const listName = formData.get("list_name");
  const source = formData.get("source");

  if (!fileEntry || !(fileEntry instanceof File)) {
    return NextResponse.json(
      { error: "file is required.", code: "missing_file" },
      { status: 400 },
    );
  }

  if (!listName || typeof listName !== "string") {
    return NextResponse.json(
      { error: "list_name is required.", code: "missing_fields" },
      { status: 400 },
    );
  }

  try {
    const csvContent = await fileEntry.text();
    const manager = new ProspectManager();
    const result = await manager.importFromCsv(
      csvContent,
      listName,
      typeof source === "string" ? source : "upload",
    );
    return NextResponse.json({ result }, { status: 201 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message, code: "import_failed" },
      { status: 500 },
    );
  }
}
