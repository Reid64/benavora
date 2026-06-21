// GET  /api/autoapply/controls  — return all active (paused=true) control states.
// POST /api/autoapply/controls  — apply a pause control.
// DELETE /api/autoapply/controls — resume (unpause) a control.
//
// Platform-level controls (control_type='platform') require admin role.
// All other controls require owner role.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { QueueControlPlane } from "@/lib/autoapply/queue-controls";

export const runtime = "nodejs";

const plane = new QueueControlPlane();

export async function GET() {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  const { supabase } = gate;
  const controls = await plane.getStatus(supabase);
  return NextResponse.json({ controls });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { control_type, target_id, reason } = body as {
    control_type?: string;
    target_id?: string;
    reason?: string;
  };

  if (!control_type) {
    return NextResponse.json(
      { error: "control_type is required." },
      { status: 400 },
    );
  }

  if (!reason) {
    return NextResponse.json(
      { error: "reason is required." },
      { status: 400 },
    );
  }

  // Platform controls require admin; everything else needs owner.
  const requiredRole = control_type === "platform" ? "admin" : "owner";
  const gate = await requireRole(requiredRole);
  if ("error" in gate) return gate.error;

  const { supabase, userId } = gate;

  try {
    switch (control_type) {
      case "platform":
        await plane.pausePlatform(reason, userId, supabase);
        break;

      case "tenant":
        if (!target_id) {
          return NextResponse.json(
            { error: "target_id (org_id) is required for tenant controls." },
            { status: 400 },
          );
        }
        await plane.pauseTenant(target_id, reason, userId, supabase);
        break;

      case "funder":
        if (!target_id) {
          return NextResponse.json(
            { error: "target_id (funder_id) is required for funder controls." },
            { status: 400 },
          );
        }
        await plane.pauseFunder(target_id, reason, supabase, userId);
        break;

      case "domain":
        if (!target_id) {
          return NextResponse.json(
            { error: "target_id (domain) is required for domain controls." },
            { status: 400 },
          );
        }
        await plane.pauseDomain(target_id, reason, supabase, userId);
        break;

      default:
        return NextResponse.json(
          { error: `Unknown control_type: ${control_type}` },
          { status: 400 },
        );
    }
  } catch {
    return NextResponse.json(
      { error: "Failed to apply control." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, control_type, target_id });
}

export async function DELETE(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { control_type, target_id } = body as {
    control_type?: string;
    target_id?: string;
  };

  if (!control_type) {
    return NextResponse.json(
      { error: "control_type is required." },
      { status: 400 },
    );
  }

  const requiredRole = control_type === "platform" ? "admin" : "owner";
  const gate = await requireRole(requiredRole);
  if ("error" in gate) return gate.error;

  const { supabase } = gate;

  try {
    switch (control_type) {
      case "platform":
        await plane.resumePlatform(supabase);
        break;

      case "tenant":
        if (!target_id) {
          return NextResponse.json(
            { error: "target_id is required." },
            { status: 400 },
          );
        }
        await plane.resumeTenant(target_id, supabase);
        break;

      case "funder":
        if (!target_id) {
          return NextResponse.json(
            { error: "target_id is required." },
            { status: 400 },
          );
        }
        await plane.resumeFunder(target_id, supabase);
        break;

      case "domain":
        if (!target_id) {
          return NextResponse.json(
            { error: "target_id is required." },
            { status: 400 },
          );
        }
        await plane.resumeDomain(target_id, supabase);
        break;

      default:
        return NextResponse.json(
          { error: `Unknown control_type: ${control_type}` },
          { status: 400 },
        );
    }
  } catch {
    return NextResponse.json(
      { error: "Failed to resume control." },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, control_type, target_id });
}
