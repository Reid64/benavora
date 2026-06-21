import { NextResponse } from "next/server";

import { requireAdmin } from "@/lib/admin/auth";
import { DomainManager } from "@/lib/admin/domain-manager";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type RouteContext = { params: { id: string } };

export async function GET(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const { id } = params;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sending_domains")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Domain not found.", code: "not_found" },
      { status: 404 },
    );
  }

  const manager = new DomainManager();
  const [health, warmup] = await Promise.all([
    manager.getDomainHealth(id).catch(() => null),
    manager.getWarmupStatus(id).catch(() => null),
  ]);

  return NextResponse.json({ domain: data, health, warmup });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  let body: { target_daily_limit?: number; is_active?: boolean };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body.", code: "bad_request" },
      { status: 400 },
    );
  }

  const { id } = params;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.target_daily_limit !== undefined)
    patch.target_daily_limit = body.target_daily_limit;
  if (body.is_active !== undefined) patch.is_active = body.is_active;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sending_domains")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Domain not found or update failed.", code: "update_failed" },
      { status: error ? 500 : 404 },
    );
  }

  return NextResponse.json({ domain: data });
}

export async function DELETE(request: Request, { params }: RouteContext) {
  try {
    await requireAdmin(request);
  } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }

  const { id } = params;
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("sending_domains")
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();

  if (error || !data) {
    return NextResponse.json(
      { error: "Domain not found.", code: "not_found" },
      { status: 404 },
    );
  }

  return NextResponse.json({ domain: data });
}
