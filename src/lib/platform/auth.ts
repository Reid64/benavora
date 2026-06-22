import "server-only";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Enums } from "@/types/database";

export type PlatformRole = Enums<"platform_role">;
export type StaffPermission = Enums<"staff_permission">;

export interface PlatformAdmin {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  platform_role: PlatformRole;
  permissions: StaffPermission[];
  is_active: boolean;
  last_login_at: string | null;
  invited_by: string | null;
  created_at: string;
  updated_at: string;
}

const ROLE_HIERARCHY: PlatformRole[] = [
  "staff_readonly",
  "staff_support",
  "staff_admin",
  "platform_owner",
];

const ALL_PERMISSIONS: StaffPermission[] = [
  "tenant_view", "tenant_manage", "tenant_impersonate",
  "billing_view", "billing_manage",
  "feature_flags_view", "feature_flags_manage",
  "staff_view", "staff_manage",
  "queue_view", "queue_manage", "queue_emergency_stop",
  "analytics_view", "error_view", "error_resolve",
  "sales_outreach_view", "sales_outreach_manage",
  "system_health_view", "audit_log_view",
];

function throwUnauthorized(): never {
  throw new Response(
    JSON.stringify({ error: "Authentication required.", code: "unauthenticated" }),
    { status: 401, headers: { "Content-Type": "application/json" } },
  );
}

function throwForbidden(message: string): never {
  throw new Response(
    JSON.stringify({ error: message, code: "forbidden" }),
    { status: 403, headers: { "Content-Type": "application/json" } },
  );
}

export async function requirePlatformAuth(options?: { permissions?: string[] }): Promise<PlatformAdmin> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) throwUnauthorized();

  const adminClient = createAdminClient();
  const { data } = await adminClient
    .from("platform_admins")
    .select("*")
    .eq("user_id", user.id)
    .eq("is_active", true)
    .single();

  if (!data) throwForbidden("Not a platform administrator.");

  const admin = data as unknown as PlatformAdmin;

  if (options?.permissions?.length) {
    if (admin.platform_role !== "platform_owner") {
      const missing = options.permissions.filter(
        (p) => !admin.permissions.includes(p as StaffPermission),
      );
      if (missing.length > 0) throwForbidden("Insufficient platform permissions.");
    }
  }

  adminClient
    .from("platform_admins")
    .update({ last_login_at: new Date().toISOString() })
    .eq("id", admin.id)
    .then(() => {});

  return admin;
}

export async function requirePlatformRole(minRole: PlatformRole): Promise<PlatformAdmin> {
  const admin = await requirePlatformAuth();
  const adminLevel = ROLE_HIERARCHY.indexOf(admin.platform_role);
  const requiredLevel = ROLE_HIERARCHY.indexOf(minRole);
  if (adminLevel < requiredLevel) throwForbidden("Insufficient platform role.");
  return admin;
}

export async function seedPlatformOwner(): Promise<void> {
  const adminClient = createAdminClient();
  const { count } = await adminClient
    .from("platform_admins")
    .select("*", { count: "exact", head: true })
    .eq("platform_role", "platform_owner");

  if ((count ?? 0) > 0) return;

  const ownerEmail = process.env.PLATFORM_OWNER_EMAIL ?? "info@faithfoundation.org";
  const { data: listData } = await adminClient.auth.admin.listUsers();
  const ownerUser = listData?.users?.find((u) => u.email === ownerEmail);
  if (!ownerUser) return;

  await adminClient.from("platform_admins").insert({
    user_id: ownerUser.id,
    email: ownerEmail,
    full_name: (ownerUser.user_metadata?.full_name as string | undefined) ?? ownerEmail,
    platform_role: "platform_owner" as PlatformRole,
    permissions: ALL_PERMISSIONS,
    is_active: true,
  });
}

export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const adminClient = createAdminClient();
  const { count } = await adminClient
    .from("platform_admins")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_active", true);
  return (count ?? 0) > 0;
}

export function hasPlatformPermission(admin: PlatformAdmin, permission: string): boolean {
  if (admin.platform_role === "platform_owner") return true;
  return admin.permissions.includes(permission as StaffPermission);
}
