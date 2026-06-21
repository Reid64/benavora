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
  LayoutDashboard,
  Library,
  Radar,
  Search,
  Target,
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
  { label: "Foundations", href: "/foundations", icon: Library },
  { label: "Opportunities", href: "/opportunities", icon: Search },
  { label: "Applications", href: "/applications", icon: KanbanSquare },
  {
    label: "AutoApply",
    href: "/autoapply",
    icon: Bot,
    children: [
      { label: "Request Profiles", href: "/autoapply/profiles" },
      { label: "Follow-Ups", href: "/autoapply/follow-ups" },
      { label: "Templates", href: "/autoapply/templates" },
      { label: "Document Vault", href: "/autoapply/documents" },
      { label: "Agreements", href: "/autoapply/agreements" },
      { label: "Notifications", href: "/autoapply/webhooks" },
      { label: "Compliance", href: "/autoapply/compliance" },
      { label: "Settings", href: "/autoapply/settings" },
      { label: "Usage & Billing", href: "/autoapply/usage" },
    ],
  },
  { label: "Draft Generator", href: "/draft-generator", icon: Wand2 },
  { label: "Documents", href: "/documents", icon: FolderOpen },
  { label: "Knowledge Base", href: "/knowledge-base", icon: Brain },
  { label: "Intelligence Library", href: "/intelligence-library", icon: BookOpen },
  { label: "Deadlines", href: "/deadlines", icon: Calendar },
  { label: "Outcomes & Analytics", href: "/outcomes", icon: BarChart3 },
  { label: "Financials", href: "/financials", icon: DollarSign },
  { label: "Reports", href: "/reports", icon: FileBarChart2 },
  { label: "Research", href: "/research", icon: Radar },
  {
    label: "Intelligence",
    href: "/intelligence",
    icon: Target,
    children: [
      { label: "Competitors", href: "/intelligence/competitors" },
      { label: "Semantic Matches", href: "/intelligence/matches" },
    ],
  },
  // Settings, Billing, Onboarding, and Audit Log live in the header avatar
  // dropdown now, so they are intentionally absent from the sidebar.
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
