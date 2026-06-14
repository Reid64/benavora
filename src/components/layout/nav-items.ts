import {
  BarChart3,
  Bell,
  Bot,
  Brain,
  Building2,
  Calendar,
  ClipboardList,
  CreditCard,
  FileBarChart2,
  Filter,
  FolderOpen,
  KanbanSquare,
  LayoutDashboard,
  Mail,
  Radar,
  RefreshCw,
  Search,
  Settings,
  Shield,
  Target,
  Users,
  Wand2,
  type LucideIcon,
} from "lucide-react";

import type { Enums } from "@/types/database";

type UserRole = Enums<"user_role">;

export type NavChild = {
  label: string;
  href: string;
};

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  /** When set, only these roles see the item. Omitted = visible to everyone. */
  roles?: UserRole[];
  /** When true, only shown after onboarding is complete. */
  requiresOnboarding?: boolean;
  /** Sub-links shown indented below the parent when parent is active. */
  children?: NavChild[];
};

export type NavOptions = {
  onboardingCompleted?: boolean;
};

/**
 * Dashboard sidebar navigation - mirrors BLUEPRINT.md section 3.3.
 * Order and labels are intentional; routes match the App Router structure
 * under src/app/(dashboard)/.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
  { label: "Alerts", href: "/alerts", icon: Bell },
  { label: "Funders", href: "/funders", icon: Building2 },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Opportunities", href: "/opportunities", icon: Search },
  { label: "Applications", href: "/applications", icon: KanbanSquare },
  { label: "Renewals", href: "/renewals", icon: RefreshCw },
  { label: "Automation", href: "/automation", icon: Bot },
  { label: "Draft Generator", href: "/draft-generator", icon: Wand2 },
  { label: "Documents", href: "/documents", icon: FolderOpen },
  { label: "Knowledge Base", href: "/knowledge-base", icon: Brain },
  { label: "Deadlines", href: "/deadlines", icon: Calendar },
  { label: "Outcomes & Analytics", href: "/outcomes", icon: BarChart3 },
  { label: "Reports", href: "/reports", icon: FileBarChart2 },
  { label: "Outreach", href: "/outreach", icon: Mail },
  { label: "Search Profiles", href: "/search-profiles", icon: Filter },
  { label: "Research", href: "/research", icon: Radar },
  {
    label: "Intelligence",
    href: "/intelligence",
    icon: Target,
    children: [{ label: "Competitors", href: "/intelligence/competitors" }],
  },
  { label: "Onboarding", href: "/onboarding", icon: ClipboardList, requiresOnboarding: true },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    children: [{ label: "Integrations", href: "/settings/integrations" }],
  },
  // Billing is owner-only (BLUEPRINT §3.2 / updated §3.3 navigation).
  { label: "Billing", href: "/billing", icon: CreditCard, roles: ["owner"] },
  // Admin - Audit Log is owner/admin only (BLUEPRINT updated §3.3 navigation).
  {
    label: "Audit Log",
    href: "/admin/audit-log",
    icon: Shield,
    roles: ["owner", "admin"],
  },
];

/** Nav items visible to the given role and onboarding state. */
export function navItemsForRole(role: UserRole | undefined, options?: NavOptions): NavItem[] {
  const onboardingCompleted = options?.onboardingCompleted ?? false;
  return NAV_ITEMS.filter((item) => {
    if (item.roles && (role === undefined || !item.roles.includes(role))) return false;
    if (item.requiresOnboarding && !onboardingCompleted) return false;
    return true;
  });
}
