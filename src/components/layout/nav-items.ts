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
  Lightbulb,
  Mail,
  Megaphone,
  MonitorDot,
  Radar,
  Send,
  Settings,
  Shield,
  ShieldCheck,
  Target,
  Upload,
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
 * Dashboard, Research, Opportunities, AutoApply, Draft Generator, and Donor
 * Discovery live in the top header bar — they are intentionally absent here.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Alerts", href: "/alerts", icon: Bell },
  { label: "Funders", href: "/funders", icon: Building2 },
  { label: "Foundations", href: "/foundations", icon: Library },
  { label: "Contacts", href: "/contacts", icon: Users },
  { label: "Applications", href: "/applications", icon: KanbanSquare },
  { label: "Documents", href: "/documents", icon: FolderOpen },
  { label: "Knowledge Base", href: "/knowledge-base", icon: Brain },
  { label: "Intelligence Library", href: "/intelligence-library", icon: BookOpen },
  { label: "Deadlines", href: "/deadlines", icon: Calendar },
  { label: "Compliance", href: "/compliance", icon: ShieldCheck },
  { label: "Outcomes & Analytics", href: "/outcomes", icon: BarChart3 },
  { label: "Financials", href: "/financials", icon: DollarSign },
  {
    label: "Reports",
    href: "/reports",
    icon: FileBarChart2,
    children: [
      { label: "Simulator", href: "/reports/simulate" },
      { label: "ROI Insights", href: "/reports/roi" },
    ],
  },
  {
    label: "Intelligence",
    href: "/intelligence",
    icon: Target,
    children: [
      { label: "Digital Twin", href: "/intelligence/twin" },
      { label: "Knowledge Engine", href: "/intelligence/knowledge" },
      { label: "Recommendations", href: "/intelligence/recommendations" },
      { label: "Competitors", href: "/intelligence/competitors" },
      { label: "Semantic Matches", href: "/intelligence/matches" },
      { label: "Reputation", href: "/intelligence/reputation" },
      { label: "Disaster Response", href: "/intelligence/disaster" },
      { label: "Community Need", href: "/intelligence/community-need" },
      { label: "Strategic Advisor", href: "/intelligence/strategic-advisor" },
    ],
  },
  { label: "Email", href: "/email", icon: Mail },
  {
    label: "Outreach",
    href: "/outreach",
    icon: Send,
    children: [
      { label: "Campaigns", href: "/outreach/campaigns" },
      { label: "Templates", href: "/outreach/templates" },
      { label: "Sequences", href: "/outreach/sequences" },
    ],
  },
];

/**
 * Donor Discovery's own top-level entry now lives in the header nav — this
 * is the drill-down link Sidebar renders in its place, only while the user
 * is inside /donor-discovery/*.
 */
export const DONOR_DISCOVERY_DRILLDOWN: NavChild = {
  label: "Prospects",
  href: "/donor-discovery/prospects",
};

/** Settings rendered at the bottom of the sidebar, separated from main nav. */
export const SETTINGS_NAV_ITEM: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: Settings,
};

/** Platform admin section — shown only to owner/admin roles. */
export const PLATFORM_NAV_ITEMS: NavItem[] = [
  { label: "Command Center", href: "/command-center", icon: Radar },
  { label: "Import", href: "/import", icon: Upload },
  { label: "Sales Outreach", href: "/admin/sales-outreach", icon: Megaphone },
  { label: "AutoApply Ops", href: "/admin/autoapply-ops", icon: Bot },
  { label: "Monitor", href: "/admin/monitor", icon: MonitorDot },
  { label: "Improvements", href: "/admin/improvements", icon: Lightbulb },
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
