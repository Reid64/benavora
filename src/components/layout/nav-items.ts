import {
  BarChart3,
  Bell,
  BookOpen,
  Bot,
  Brain,
  Building2,
  Calendar,
  DollarSign,
  FileBarChart2,
  FolderOpen,
  KanbanSquare,
  Library,
  Mail,
  Megaphone,
  Settings,
  Shield,
  Target,
  Telescope,
  Users,
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
 * Primary sidebar navigation items in display order.
 * Dashboard, Research, Opportunities, AutoApply, and Draft Generator
 * live in the top header bar — they are intentionally absent here.
 */
export const NAV_ITEMS: NavItem[] = [
  // Discovery feeds Opportunities/AutoApply in the header bar (Discover ->
  // Score -> Apply -> Track, DONOR_DISCOVERY_ARCHITECTURE.md §7) — placed
  // first so it sits immediately below that row.
  {
    label: "Donor Discovery",
    href: "/donor-discovery",
    icon: Telescope,
    children: [{ label: "Prospects", href: "/donor-discovery/prospects" }],
  },
  { label: "Alerts", href: "/alerts", icon: Bell },
  { label: "Funders", href: "/funders", icon: Building2 },
  { label: "Foundations", href: "/foundations", icon: Library },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Applications", href: "/applications", icon: KanbanSquare },
  { label: "Documents", href: "/documents", icon: FolderOpen },
  { label: "Knowledge Base", href: "/knowledge-base", icon: Brain },
  { label: "Intelligence Library", href: "/intelligence-library", icon: BookOpen },
  { label: "Deadlines", href: "/deadlines", icon: Calendar },
  { label: "Outcomes & Analytics", href: "/outcomes", icon: BarChart3 },
  { label: "Financials", href: "/financials", icon: DollarSign },
  { label: "Reports", href: "/reports", icon: FileBarChart2 },
  {
    label: "Intelligence",
    href: "/intelligence",
    icon: Target,
    children: [
      { label: "Recommendations", href: "/intelligence/recommendations" },
      { label: "Competitors", href: "/intelligence/competitors" },
      { label: "Semantic Matches", href: "/intelligence/matches" },
    ],
  },
  { label: "Email", href: "/email", icon: Mail },
];

/** Settings rendered at the bottom of the sidebar, separated from main nav. */
export const SETTINGS_NAV_ITEM: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: Settings,
};

/** Platform admin section — shown only to owner/admin roles. */
export const PLATFORM_NAV_ITEMS: NavItem[] = [
  { label: "Sales Outreach", href: "/admin/sales-outreach", icon: Megaphone },
  { label: "AutoApply Ops", href: "/admin/autoapply-ops", icon: Bot },
  { label: "Audit Log", href: "/admin/audit-log", icon: Shield },
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
