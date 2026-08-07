// GET/PUT /api/command-center/layout — per-owner Command Center panel order
// (FEATURE_REGISTRY_v2.md #154 "Configurable Panel Layout"). Persisted on
// profiles.command_center_layout (migration 131, jsonb) — this page is
// owner-gated (see src/app/(dashboard)/command-center/page.tsx), so one
// profiles row == one viewer's saved layout, no separate table needed.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { COMMAND_CENTER_PANEL_IDS, type CommandCenterPanelId } from "@/lib/command-center/panels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isValidOrder(value: unknown): value is CommandCenterPanelId[] {
  if (!Array.isArray(value)) return false;
  if (value.length !== COMMAND_CENTER_PANEL_IDS.length) return false;
  const asSet = new Set(value);
  if (asSet.size !== COMMAND_CENTER_PANEL_IDS.length) return false;
  return value.every((id) => COMMAND_CENTER_PANEL_IDS.includes(id as CommandCenterPanelId));
}

export async function GET() {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const { data, error } = await gate.supabase
    .from("profiles")
    .select("command_center_layout")
    .eq("id", gate.userId)
    .single();

  if (error) {
    return NextResponse.json({ error: "Could not load saved layout." }, { status: 500 });
  }

  const saved = data?.command_center_layout;
  const order = isValidOrder(saved) ? saved : null;
  return NextResponse.json({ order });
}

export async function PUT(request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const body = (await request.json().catch(() => null)) as { order?: unknown } | null;
  if (!body || !isValidOrder(body.order)) {
    return NextResponse.json(
      { error: "order must be a permutation of the real panel id set." },
      { status: 400 },
    );
  }

  const { error } = await gate.supabase
    .from("profiles")
    .update({ command_center_layout: body.order })
    .eq("id", gate.userId);

  if (error) {
    return NextResponse.json({ error: "Could not save layout." }, { status: 500 });
  }

  return NextResponse.json({ order: body.order });
}
