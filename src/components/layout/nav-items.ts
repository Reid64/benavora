import {
  Brain,
  Building,
  HeartPulse,
  KanbanSquare,
  LayoutDashboard,
  Lightbulb,
  Megaphone,
  MonitorDot,
  Radar,
  ScanSearch,
  Send,
  Settings,
  Shield,
  Bot,
  Target,
  Upload,
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
  /**
   * Per-item icon color override, e.g. a section's own accent - mirrors the
   * pattern already used for PROGRAMS_NAV_ITEMS's green icon. Sidebar/header
   * *text* stays solid white unconditionally (DESIGN_SYSTEM.md's hard rule);
   * only the icon may carry a section accent.
   */
  iconColor?: (active: boolean) => string;
};

export type NavOptions = {
  onboardingCompleted?: boolean;
};

/**
 * Primary sidebar navigation - 6 top-level sections plus Settings (rendered
 * separately at the bottom of the rail). Every real page previously reachable
 * from the sidebar's flat item list is folded into the section it fits best,
 * so nothing that used to be reachable becomes a dead end - see the nav
 * redesign notes for the full old-item -> new-section mapping.
 * Dashboard, Research, Opportunities, AutoApply, Draft Generator, and Donor
 * Discovery also live in the top header bar - see the PERMANENT comment in
 * Header.tsx before touching that list.
 */
export const NAV_ITEMS: NavItem[] = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: LayoutDashboard,
    children: [
      { label: "Activity", href: "/activity" },
      { label: "Strategic Recommendations", href: "/intelligence/strategic-advisor" },
    ],
  },
  {
    label: "Prospects & Analysis",
    href: "/intelligence/pil/prospects",
    icon: ScanSearch,
    // Gold #C49A4F - this section's accent per governance/DESIGN_SYSTEM.md.
    iconColor: (active) => (active ? "#FFFFFF" : "#C49A4F"),
    children: [
      { label: "My Prospects", href: "/intelligence/pil/prospects" },
      { label: "Analysis Results", href: "/intelligence/pil/research" },
      { label: "Run New Analysis", href: "/intelligence/pil/discover" },
      { label: "Pending Review", href: "/intelligence/pil/review-queue" },
      { label: "Giving Signals", href: "/intelligence/donor-intent" },
      { label: "Community Needs", href: "/intelligence/community-need" },
      { label: "Disaster Response", href: "/intelligence/disaster" },
    ],
  },
  {
    label: "Opportunities",
    href: "/opportunities",
    icon: Target,
    children: [
      { label: "Find Opportunities", href: "/opportunities/new" },
      { label: "All Opportunities", href: "/opportunities" },
      { label: "Matched for My Prospects", href: "/intelligence/match-feed" },
      { label: "Funder Matches", href: "/intelligence/matches" },
      { label: "Competitor Insights", href: "/intelligence/competitors" },
      { label: "Foundations", href: "/foundations" },
      { label: "Funders", href: "/funders" },
    ],
  },
  {
    label: "Applications",
    href: "/applications",
    icon: KanbanSquare,
    children: [
      { label: "Draft Applications", href: "/draft-generator" },
      { label: "Ready to Submit", href: "/autoapply/queue" },
      { label: "Needs Attention", href: "/autoapply/review-queue" },
      { label: "Submitted & Tracking", href: "/applications" },
      { label: "Gap Analysis", href: "/intelligence/gap-analysis" },
      { label: "Documents", href: "/documents" },
      { label: "Deadlines", href: "/deadlines" },
    ],
  },
  {
    label: "Engagement",
    href: "/email",
    icon: Send,
    children: [
      { label: "Email Campaigns", href: "/email/campaigns" },
      { label: "Outreach", href: "/outreach" },
      { label: "Relationship Management", href: "/contacts" },
      { label: "Recommendations", href: "/intelligence/recommendations" },
      { label: "Funder & Contact Monitoring", href: "/intelligence/reputation" },
      { label: "Relationship Network", href: "/intelligence/relationship-graph" },
      { label: "Donation Marketplace", href: "/marketplace" },
    ],
  },
  {
    label: "Resources",
    href: "/knowledge-base",
    icon: Brain,
    children: [
      { label: "Knowledge Base", href: "/knowledge-base" },
      { label: "Organization Profile", href: "/intelligence/twin" },
      { label: "Knowledge Search", href: "/intelligence/knowledge" },
      { label: "Nonprofit Directory", href: "/nonprofits" },
      { label: "Templates", href: "/email/templates" },
    ],
  },
];

/**
 * Donor Discovery's own top-level entry now lives in the header nav - these
 * are the drill-down links Sidebar renders in its place, only while the user
 * is inside /donor-discovery/*.
 */
export const DONOR_DISCOVERY_DRILLDOWN: NavChild = {
  label: "Prospects",
  href: "/donor-discovery/prospects",
};

/** Intent Signals sits alongside Prospects in the donor-discovery drilldown
 * section - see DONOR_DISCOVERY_DRILLDOWN above for why this isn't a normal
 * NAV_ITEMS entry. */
export const DONOR_DISCOVERY_NAV_ITEMS: NavChild[] = [
  DONOR_DISCOVERY_DRILLDOWN,
  { label: "Intent Signals", href: "/donor-discovery/intent-signals" },
];

/**
 * Program features - org-facing feature programs, shown in their own
 * "Programs" sidebar section (always visible, not role-gated).
 */
export const PROGRAMS_NAV_ITEMS: NavItem[] = [];

/**
 * Settings - rendered at the bottom of the sidebar, separated from main nav.
 * Carries the smaller admin/config pages that don't fit one of the 6 primary
 * sections above (Compliance, Financials, Reports, Alerts, Outcomes &
 * Analytics), shown as children when Settings is the active section.
 */
export const SETTINGS_NAV_ITEM: NavItem = {
  label: "Settings",
  href: "/settings",
  icon: Settings,
  children: [
    { label: "Compliance", href: "/compliance" },
    { label: "Financials", href: "/financials" },
    { label: "Reports", href: "/reports" },
    { label: "Alerts", href: "/alerts" },
    { label: "Outcomes & Analytics", href: "/outcomes" },
  ],
};

/** Platform admin section - shown only to owner/admin roles. */
export const PLATFORM_NAV_ITEMS: NavItem[] = [
  { label: "Command Center", href: "/command-center", icon: Radar },
  { label: "Organizations", href: "/admin/orgs", icon: Building },
  { label: "System Health", href: "/admin/system", icon: HeartPulse },
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
