export type TenantRole = "owner" | "admin" | "writer" | "viewer";

const TENANT_ROLE_HIERARCHY: TenantRole[] = ["viewer", "writer", "admin", "owner"];

export function canAccess(userRole: string, requiredRole: string): boolean {
  const userLevel = TENANT_ROLE_HIERARCHY.indexOf(userRole as TenantRole);
  const requiredLevel = TENANT_ROLE_HIERARCHY.indexOf(requiredRole as TenantRole);
  if (userLevel === -1 || requiredLevel === -1) return false;
  return userLevel >= requiredLevel;
}

const VIEWER_NAV: string[] = [
  "dashboard", "funders", "contacts", "opportunities", "applications",
  "documents", "knowledge-base", "deadlines", "analytics",
];
const WRITER_NAV: string[] = [...VIEWER_NAV, "draft-generator", "outreach"];
const ADMIN_NAV: string[] = [...WRITER_NAV, "autoapply", "settings", "intelligence-library"];
const OWNER_NAV: string[] = [
  ...ADMIN_NAV, "settings/billing", "settings/team", "settings/integrations",
];

export function getNavItemsForRole(userRole: string): string[] {
  switch (userRole) {
    case "owner": return OWNER_NAV;
    case "admin": return ADMIN_NAV;
    case "writer": return WRITER_NAV;
    default: return VIEWER_NAV;
  }
}

const VIEWER_DISABLED: string[] = ["create", "edit", "delete", "submit", "generate", "upload"];
const WRITER_DISABLED: string[] = ["delete", "org-settings", "billing"];
const ADMIN_DISABLED: string[] = ["billing-management", "delete-organization"];

export function getDisabledActionsForRole(userRole: string): string[] {
  switch (userRole) {
    case "owner": return [];
    case "admin": return ADMIN_DISABLED;
    case "writer": return WRITER_DISABLED;
    default: return VIEWER_DISABLED;
  }
}
