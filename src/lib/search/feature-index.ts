import type { Enums } from "@/types/database";

// Data source for the global command-palette search (Cmd+K style). Every
// entry below points at a route that is genuinely reachable in production
// today — either a direct nav-items.ts / Header.tsx tab, or a page reached
// via a real in-app link (e.g. /renewals from Applications, /follow-ups from
// an application's "Generate Follow-Up" action). Orphaned pages with no
// inbound link anywhere in the app (e.g. /outreach/sequences, the AutoApply
// sub-pages superseded by inline sections on /autoapply) are deliberately
// excluded — see the FORGE task that built this file for the verification
// pass. `requiredRole` reflects the actual role check performed by the
// route's own page/server code, not a guess from nav visibility: most pages
// in this app only gate individual write actions (via `canEdit`), not page
// access, so their `requiredRole` is "viewer" (any authenticated user) even
// when the page is only linked from an owner-only nav section (e.g. /import).
// This file is data only — no component logic.

export type FeatureIndexEntry = {
  label: string;
  route: string;
  description: string;
  keywords: string[];
  requiredRole: Enums<"user_role">;
};

export const FEATURE_INDEX: FeatureIndexEntry[] = [
  // ── Header tabs ────────────────────────────────────────────────────────
  {
    label: "Dashboard",
    route: "/dashboard",
    description:
      "Home dashboard: FlightPathHUD 6-stage lifecycle cards, today's action items, pipeline and deadline widgets, 24-hour autonomous activity feed.",
    keywords: ["home", "overview", "flightpath", "hud", "action items", "pipeline widget"],
    requiredRole: "viewer",
  },
  {
    label: "Research",
    route: "/research",
    description:
      "Parallel AI research agents scanning Grants.gov, SAM.gov, ProPublica, and other sources for new funding opportunities.",
    keywords: ["discover opportunities", "parallel research agents", "grants.gov", "sam.gov", "propublica"],
    requiredRole: "viewer",
  },
  {
    label: "Opportunities",
    route: "/opportunities",
    description:
      "Browse and filter every discovered funding opportunity: eligibility score, AI probability-of-award badge, keyword tags, deadline.",
    keywords: ["grants", "funding opportunities", "rfps", "eligibility score", "keyword search", "land bank discovery"],
    requiredRole: "viewer",
  },
  {
    label: "AutoApply",
    route: "/autoapply",
    description:
      "Browser-automation submission queue: form templates, priority scoring, CAPTCHA solving, success analytics.",
    keywords: ["auto apply", "automation queue", "form fill", "submission automation", "captcha"],
    requiredRole: "viewer",
  },
  {
    label: "Draft Generator",
    route: "/draft-generator",
    description:
      "AI-generated grant narrative drafts using your Knowledge Base and proven narratives, with confidence scoring.",
    keywords: ["ai draft", "narrative generator", "claude draft", "confidence score", "humanizer"],
    requiredRole: "viewer",
  },
  {
    label: "Donor Discovery",
    route: "/donor-discovery",
    description: "Corporate and civic donor prospecting hub: NAICS/geography search, connectors, prospects, outreach.",
    keywords: ["corporate prospects", "donor discovery hub", "company giving"],
    requiredRole: "viewer",
  },

  // ── Sidebar: primary nav ──────────────────────────────────────────────
  {
    label: "Alerts",
    route: "/alerts",
    description: "In-app notification center for automation events, approaching deadlines, agent failures, key expirations.",
    keywords: ["notifications", "bell", "automation notifications"],
    requiredRole: "viewer",
  },
  {
    label: "Activity",
    route: "/activity",
    description: "Timeline of recent account and automation activity across the organization.",
    keywords: ["audit", "recent activity", "timeline"],
    requiredRole: "viewer",
  },
  {
    label: "Funders",
    route: "/funders",
    description: "Searchable funder CRM: 12 category types, relationship score, contacts, opportunities, applications, notes.",
    keywords: ["funder crm", "grantmakers", "relationship score", "funder database"],
    requiredRole: "viewer",
  },
  {
    label: "Foundations",
    route: "/foundations",
    description: "Foundation directory of 130,000+ enriched foundation records: assets, giving focus, key people, contact info.",
    keywords: ["foundation directory", "990-pf", "giving history", "foundation search"],
    requiredRole: "viewer",
  },
  {
    label: "Contacts",
    route: "/contacts",
    description: "Contact CRM linked to funders: relationship status (cold/warm/active/champion), activity log.",
    keywords: ["contact crm", "funder contacts", "relationship status"],
    requiredRole: "viewer",
  },
  {
    label: "Applications",
    route: "/applications",
    description: "12-stage kanban application pipeline with drag-and-drop, stage history, application cloning, link to Renewals.",
    keywords: ["kanban", "pipeline", "application tracker", "stage transitions"],
    requiredRole: "viewer",
  },
  {
    label: "Application Cloning",
    route: "/applications",
    description: "Clone an existing application's latest draft, AI-adapted for a different opportunity.",
    keywords: ["clone application", "duplicate application", "adapt draft"],
    requiredRole: "viewer",
  },
  {
    label: "Documents",
    route: "/documents",
    description: "Document repository: drag-and-drop uploads, 8 categories, expiration warnings, linked to applications.",
    keywords: ["file upload", "document repository", "expiration warnings"],
    requiredRole: "viewer",
  },
  {
    label: "Knowledge Base",
    route: "/knowledge-base",
    description: "Organization profile, reusable narrative blocks, and standard Q&A answers that power AI drafting and scoring.",
    keywords: ["kb", "org profile overview", "narrative blocks", "proven narratives"],
    requiredRole: "viewer",
  },
  {
    label: "Organization Profile",
    route: "/knowledge-base/profile",
    description:
      "The org profile section of the Knowledge Base: mission, programs, board members. Entry point to AI-generated board meeting packets.",
    keywords: ["org profile", "board members", "board packet", "mission statement"],
    requiredRole: "viewer",
  },
  {
    label: "Board Meeting Packets",
    route: "/knowledge-base/profile",
    description:
      "AI-generated board meeting packets: pipeline summary, plain-language financials, discussion items — linked from a board member's profile.",
    keywords: ["board packet", "board meeting", "plain language financials", "board portal"],
    requiredRole: "viewer",
  },
  {
    label: "Full Knowledge Base Editor",
    route: "/knowledge-base/edit",
    description:
      "The complete 10-section Knowledge Base editor feeding AI drafting, probability scoring, and your organization profile.",
    keywords: ["kb editor", "edit organization profile", "10-section profile"],
    requiredRole: "viewer",
  },
  {
    label: "Narrative Blocks",
    route: "/knowledge-base/narratives",
    description: "Reusable narrative blocks with category tags and proven-effectiveness badges for reuse in AI drafts.",
    keywords: ["narrative library", "proven narrative", "reusable blocks"],
    requiredRole: "viewer",
  },
  {
    label: "Standard Answers",
    route: "/knowledge-base/answers",
    description: "Standard Q&A answers reused across grant applications and forms.",
    keywords: ["standard q&a", "boilerplate answers", "faq"],
    requiredRole: "viewer",
  },
  {
    label: "Deadlines",
    route: "/deadlines",
    description: "Calendar, week, and list views of every deadline, color-coded urgency, Google Calendar sync, predicted deadlines.",
    keywords: ["grant calendar", "deadline tracker", "google calendar sync", "predicted deadlines", "calendar view"],
    requiredRole: "viewer",
  },
  {
    label: "Compliance",
    route: "/compliance",
    description: "Compliance calendar for reporting, spending-restriction, matching-fund, and regulatory obligations.",
    keywords: ["compliance calendar", "obligations", "overdue"],
    requiredRole: "viewer",
  },
  {
    label: "Compliance Pre-Check",
    route: "/compliance",
    description: "AI check that flags missing or non-compliant requirements before an application proceeds.",
    keywords: ["pre-submission check", "eligibility check", "requirement validation"],
    requiredRole: "viewer",
  },
  {
    label: "Outcomes & Analytics",
    route: "/outcomes",
    description: "Award/denial/partial outcome tracking, funder feedback, win-rate trends, proven-narrative pattern learning.",
    keywords: ["analytics dashboard", "win rate", "outcome tracking", "award denied", "recursive learning"],
    requiredRole: "viewer",
  },
  {
    label: "Financials",
    route: "/financials",
    description: "Financial reconciliation: budgeted vs. spent per awarded grant, reporting status, budget and expense records.",
    keywords: ["grant financials", "budget vs actual", "reconciliation report", "expenses"],
    requiredRole: "viewer",
  },
  {
    label: "Marketplace",
    route: "/marketplace",
    description: "Donation recommendation marketplace: list surplus/available donations, request and approve matches between orgs.",
    keywords: ["donation marketplace", "donor listing", "match request"],
    requiredRole: "viewer",
  },
  {
    label: "Reports",
    route: "/reports",
    description: "Reports hub: Simulator, ROI Insights, and Funding Forecast.",
    keywords: ["reports hub"],
    requiredRole: "viewer",
  },
  {
    label: "Simulator",
    route: "/reports/simulate",
    description: "3-year scenario builder projecting funding outcomes under different assumptions (lose funder, budget cut, expansion).",
    keywords: ["scenario builder", "predictive fundraising simulator", "budget cut scenario", "impact simulation"],
    requiredRole: "viewer",
  },
  {
    label: "ROI Insights",
    route: "/reports/roi",
    description: "ROI optimization dashboard aggregating submission variables and return-on-effort insights.",
    keywords: ["roi dashboard", "return on investment", "submission variables"],
    requiredRole: "viewer",
  },
  {
    label: "Funding Forecast",
    route: "/reports/forecast",
    description: "90-day and 12-month AI funding forecast with narrative risk and opportunity summary.",
    keywords: ["forecast dashboard", "funding projection", "predictive funding"],
    requiredRole: "viewer",
  },
  {
    label: "Intelligence",
    route: "/intelligence",
    description: "Intelligence hub: organization profile, matched opportunities, knowledge engine, gap analysis, funder monitoring, and more.",
    keywords: ["intelligence hub"],
    requiredRole: "viewer",
  },
  {
    label: "Organization Profile",
    route: "/intelligence/twin",
    description: "Your organization's profile with a completeness score, feeding AI draft generation.",
    keywords: ["organization profile", "completeness score"],
    requiredRole: "viewer",
  },
  {
    label: "Matched Opportunities",
    route: "/intelligence/match-feed",
    description: "Personalized opportunity match feed ranked by mission/program/geography affinity and probability score.",
    keywords: ["personalized feed", "match score", "recommended opportunities"],
    requiredRole: "viewer",
  },
  {
    label: "Knowledge Engine",
    route: "/intelligence/knowledge",
    description: "Query cross-org knowledge patterns and funded-proposal precedent for a topic.",
    keywords: ["knowledge query", "pattern search", "precedent search"],
    requiredRole: "viewer",
  },
  {
    label: "Recommendations",
    route: "/intelligence/recommendations",
    description: "AI relationship-building recommendations and engagement suggestions per funder.",
    keywords: ["relationship recommendations", "engagement suggestions", "next best action"],
    requiredRole: "viewer",
  },
  {
    label: "Gap Analysis",
    route: "/intelligence/gap-analysis",
    description:
      "Narrative gap analysis (missing Knowledge Base content per opportunity) and geographic eligibility mismatch detection, with concrete fix recommendations.",
    keywords: ["knowledge gap", "narrative gap", "geographic mismatch", "funding gap analysis"],
    requiredRole: "viewer",
  },
  {
    label: "Competitors",
    route: "/intelligence/competitors",
    description:
      "Competitor intelligence sourced from 990-PF giving history: who else is funded by the same funders in your area. Enterprise/Consultant plans only.",
    keywords: ["competitor intelligence", "who else is funded", "990-pf competitors"],
    requiredRole: "viewer",
  },
  {
    label: "Funder Matches",
    route: "/intelligence/matches",
    description: "AI funder matching against your organization's mission and programs.",
    keywords: ["funder matching", "ai match funders"],
    requiredRole: "viewer",
  },
  {
    label: "Funder & Contact Monitoring",
    route: "/intelligence/reputation",
    description: "Monitoring for funders and contacts: severity-classified alerts, auto-monitor on add.",
    keywords: ["funder monitoring", "monitoring alerts"],
    requiredRole: "viewer",
  },
  {
    label: "Disaster Response",
    route: "/intelligence/disaster",
    description: "Real-time FEMA disaster declarations matched against emergency funds, with auto-deploy response.",
    keywords: ["fema", "disaster declarations", "emergency funds", "disaster response agent"],
    requiredRole: "viewer",
  },
  {
    label: "Community Need",
    route: "/intelligence/community-need",
    description: "Community need prediction using public demographic and social-need data.",
    keywords: ["community need prediction", "needs assessment"],
    requiredRole: "viewer",
  },
  {
    label: "Giving Signals",
    route: "/intelligence/donor-intent",
    description: "Monitoring for signals of corporate giving intent.",
    keywords: ["giving intent signals", "corporate giving signals"],
    requiredRole: "viewer",
  },
  {
    label: "Relationship Network",
    route: "/intelligence/relationship-graph",
    description:
      "Visual map of your organization's philanthropic relationship network, with a warm-introduction path finder between your org and a funder.",
    keywords: ["relationship network", "path finder", "warm introduction", "network graph"],
    requiredRole: "viewer",
  },
  {
    label: "Strategic Recommendations",
    route: "/intelligence/strategic-advisor",
    description: "Command center synthesizing forecast, pipeline, and relationship data into recommendations.",
    keywords: ["strategic recommendations"],
    requiredRole: "viewer",
  },
  {
    label: "Email Campaigns",
    route: "/email/campaigns",
    description: "Email campaign builder and send tracking.",
    keywords: ["email campaigns", "bulk email", "campaign builder"],
    requiredRole: "viewer",
  },
  {
    label: "Email Templates",
    route: "/email/templates",
    description: "Reusable email templates for campaigns and follow-ups.",
    keywords: ["email templates"],
    requiredRole: "viewer",
  },
  {
    label: "Outreach Templates",
    route: "/outreach/templates",
    description: "Cold outreach and follow-up sequence templates, with content-variant toggling.",
    keywords: ["outreach templates", "cold outreach", "template variants", "multi-channel outreach"],
    requiredRole: "viewer",
  },

  // ── Donor Discovery sub-pages ─────────────────────────────────────────
  {
    label: "Prospects",
    route: "/donor-discovery/prospects",
    description: "Corporate/civic donor prospect list with bulk move and route-to-outreach actions.",
    keywords: ["prospect list", "donor prospects"],
    requiredRole: "viewer",
  },
  {
    label: "Intent Signals",
    route: "/donor-discovery/intent-signals",
    description: "Corporate intent signals detected for prospects, with a run-analysis action.",
    keywords: ["intent signals", "corporate intent"],
    requiredRole: "viewer",
  },
  {
    label: "New Discovery",
    route: "/donor-discovery/new",
    description: "Search for new donor prospects by NAICS industry taxonomy and location.",
    keywords: ["naics search", "new prospect search", "industry taxonomy"],
    requiredRole: "viewer",
  },
  {
    label: "Discover Nearby Businesses",
    route: "/donor-discovery/discover",
    description: "Find nearby businesses via Google Places, preview real results, and add them to your prospect pipeline.",
    keywords: ["google places search", "nearby businesses", "business discovery"],
    requiredRole: "viewer",
  },
  {
    label: "Corporate Marketplace",
    route: "/donor-discovery/marketplace",
    description: "Prospect search UI with ownership, employee-count, and revenue filters across corporate prospects.",
    keywords: ["corporate marketplace", "prospect filters"],
    requiredRole: "viewer",
  },
  {
    label: "Outreach Composer",
    route: "/donor-discovery/outreach",
    description: "AI-personalized outreach message generator per corporate prospect, using org Knowledge Base and prospect facts.",
    keywords: ["outreach composer", "personalized outreach generator", "donor outreach"],
    requiredRole: "viewer",
  },
  {
    label: "Connectors",
    route: "/donor-discovery/connectors",
    description: "Manage data-source connectors (e.g. Google Places) powering donor discovery.",
    keywords: ["donor discovery connectors", "data source connections"],
    requiredRole: "viewer",
  },

  // ── Resources ─────────────────────────────────────────────────────────
  {
    label: "Nonprofit Directory",
    route: "/nonprofits",
    description: "Searchable directory of IRS Business Master File nonprofit records.",
    keywords: ["nonprofit directory", "irs bmf", "990 lookup"],
    requiredRole: "viewer",
  },

  // ── Renewals / Follow-Ups (reachable via in-page links, not top nav) ──
  {
    label: "Renewals",
    route: "/renewals",
    description: "Renewal Tracker: auto-created renewal opportunity records for recurring grants, linked from Applications.",
    keywords: ["renewal tracker", "recurring grants"],
    requiredRole: "viewer",
  },
  {
    label: "Follow-Ups",
    route: "/follow-ups",
    description:
      "AI-generated follow-up email sequences per application (check-in, thank-you, feedback request, renewal prep) — reached via an application's Generate Follow-Up action.",
    keywords: ["follow-up sequence", "thank you email", "check-in email", "generate follow-up"],
    requiredRole: "viewer",
  },

  // ── Settings ──────────────────────────────────────────────────────────
  {
    label: "Settings",
    route: "/settings",
    description: "Organization settings, user management with role assignment, feature flags, notification preferences.",
    keywords: ["organization settings", "user management", "role assignment"],
    requiredRole: "viewer",
  },
  {
    label: "Branding",
    route: "/settings/branding",
    description: "Logo, colors, and organization branding used across the app and the white-label portal.",
    keywords: ["branding", "logo", "org colors"],
    requiredRole: "viewer",
  },
  {
    label: "Organization Setup",
    route: "/settings/organization-setup",
    description: "Organization profile setup: mission, EIN, address, and basic org details.",
    keywords: ["org setup", "ein", "organization details"],
    requiredRole: "viewer",
  },
  {
    label: "Notification Preferences",
    route: "/settings/notifications",
    description: "Per-event notification preferences: in-app and email, digest frequency.",
    keywords: ["notification preferences", "email digest"],
    requiredRole: "viewer",
  },
  {
    label: "Autonomous Agent Settings",
    route: "/settings/agents",
    description: "Per-org toggle controls and threshold sliders for autonomous agents (owner/admin can manage flags).",
    keywords: ["autonomous settings", "agent toggles", "threshold slider"],
    requiredRole: "viewer",
  },
  {
    label: "Integration Settings",
    route: "/settings/integrations",
    description: "Connector cards for Grants.gov, ProPublica, State Portals, and SAM.gov — configure keys and run manually.",
    keywords: ["integrations", "sam.gov key", "grants.gov", "state portals"],
    requiredRole: "viewer",
  },
  {
    label: "Custom API Connectors",
    route: "/settings/custom-apis",
    description: "Configure custom API connections that create opportunities from external data sources (owner/admin manage).",
    keywords: ["custom api connector", "external api", "field mapping"],
    requiredRole: "viewer",
  },
  {
    label: "Custom Scraping Targets",
    route: "/settings/scraping",
    description: "Configure custom web-scraping targets for opportunity discovery (owner/admin manage).",
    keywords: ["custom scraping", "scrape target", "web scraper settings"],
    requiredRole: "viewer",
  },
  {
    label: "White-Label Portal",
    route: "/settings/white-label",
    description: "Consultant white-label client management: branding, custom domain, master dashboard, client switching (owner/admin manage).",
    keywords: ["white label", "consultant portal", "client management", "custom domain"],
    requiredRole: "viewer",
  },
  {
    label: "Billing",
    route: "/billing",
    description: "Subscription tier, usage limits, Stripe checkout and billing portal. Owner-only.",
    keywords: ["billing", "subscription", "stripe", "usage limits", "plan tier"],
    requiredRole: "owner",
  },
  {
    label: "Onboarding",
    route: "/onboarding",
    description: "7-step guided onboarding wizard for new organizations.",
    keywords: ["onboarding wizard", "setup steps"],
    requiredRole: "viewer",
  },
  {
    label: "Search Profile Configuration",
    route: "/search-profiles/configure",
    description:
      "Saved keyword search configuration: keywords, categories, geographic scope, amount range, source-type toggles, focus areas.",
    keywords: ["search profiles", "discovery preferences", "keyword configuration", "saved search"],
    requiredRole: "viewer",
  },
  {
    label: "Import",
    route: "/import",
    description: "3-step CSV import wizard: column mapping, preview, duplicate detection, import funders/prospects.",
    keywords: ["csv import", "bulk import", "import wizard"],
    requiredRole: "viewer",
  },

  // ── AutoApply sub-pages ───────────────────────────────────────────────
  {
    label: "AutoApply Settings",
    route: "/autoapply/settings",
    description: "AutoApply configuration: daily submission caps, semi/autonomous mode, portal credentials.",
    keywords: ["autoapply settings", "submission caps", "autonomous mode", "portal credentials"],
    requiredRole: "viewer",
  },
  {
    label: "AutoApply Controls",
    route: "/autoapply/controls",
    description: "Autonomous Mode panel and nightly batch queuer controls for AutoApply.",
    keywords: ["autoapply controls", "nightly batch", "autonomous queuer"],
    requiredRole: "viewer",
  },
  {
    label: "AutoApply Compliance",
    route: "/autoapply/compliance",
    description: "Compliance checks specific to automated form submissions.",
    keywords: ["autoapply compliance"],
    requiredRole: "viewer",
  },

  // ── Platform admin (owner-only) ───────────────────────────────────────
  {
    label: "Command Center",
    route: "/command-center",
    description:
      "Owner-only executive command center: real-time agent activity, AI pipeline status, org drill-down, configurable/TV-mode panels.",
    keywords: ["command center", "executive dashboard", "tv mode", "fullscreen dashboard"],
    requiredRole: "owner",
  },
  {
    label: "Organizations",
    route: "/admin/orgs",
    description: "Cross-org admin view of every organization on the platform.",
    keywords: ["admin orgs", "all organizations", "tenant list"],
    requiredRole: "owner",
  },
  {
    label: "System Health",
    route: "/admin/system",
    description: "Platform system health and diagnostics.",
    keywords: ["system health", "diagnostics", "platform status"],
    requiredRole: "owner",
  },
  {
    label: "Sales Outreach",
    route: "/admin/sales-outreach",
    description: "Internal sales/prospecting outreach tools for growing the platform's own customer base.",
    keywords: ["sales outreach admin", "platform sales"],
    requiredRole: "owner",
  },
  {
    label: "AutoApply Ops",
    route: "/admin/autoapply-ops",
    description: "Cross-org AutoApply operations monitoring: queue health, failures, retries.",
    keywords: ["autoapply ops", "automation ops", "queue health"],
    requiredRole: "owner",
  },
  {
    label: "Monitor",
    route: "/admin/monitor",
    description: "Platform-wide monitoring dashboard.",
    keywords: ["platform monitor", "system monitor"],
    requiredRole: "owner",
  },
  {
    label: "Improvements",
    route: "/admin/improvements",
    description: "Review queue for AI self-improvement proposals (the Continuous Improvement Engine agent).",
    keywords: ["improvement proposals", "self-improvement agent"],
    requiredRole: "owner",
  },
  {
    label: "Audit Log",
    route: "/admin/audit-log",
    description: "Searchable log of all user and system actions across the platform.",
    keywords: ["audit log", "action history"],
    requiredRole: "owner",
  },

  // ── Feature-level entries embedded in the pages above ────────────────
  {
    label: "Budget Narrative Generator",
    route: "/draft-generator",
    description: "Generate a structured, funder-ready budget narrative and line items.",
    keywords: ["budget narrative", "budget generator", "line items"],
    requiredRole: "viewer",
  },
  {
    label: "Multi-Model Consensus",
    route: "/draft-generator",
    description: "Cross-check an AI draft against multiple models before finalizing.",
    keywords: ["multi-model consensus", "draft cross-check"],
    requiredRole: "viewer",
  },
  {
    label: "Draft Version History",
    route: "/draft-generator",
    description: "Saved draft versions with full version history per application.",
    keywords: ["draft versions", "version history"],
    requiredRole: "viewer",
  },
  {
    label: "Probability Badges",
    route: "/opportunities",
    description: "Color-coded AI probability-of-award badge and sort-by-score on every opportunity.",
    keywords: ["probability badge", "success probability", "score sort"],
    requiredRole: "viewer",
  },
  {
    label: "Fundability Score",
    route: "/opportunities",
    description: "Claude-generated fundability analysis panel on an opportunity's detail page.",
    keywords: ["fundability score", "fundability intelligence"],
    requiredRole: "viewer",
  },
];
