export type NavLink = { label: string; href: string; blurb?: string };
export type NavGroup = { label: string; href: string; items: NavLink[] };
export const PLATFORM: NavGroup = { label: "Platform", href: "/platform", items: [
  { label: "Funding Intelligence", href: "/platform/funding-intelligence", blurb: "Reads the NOFO, scores eligibility, flags what you fail." },
  { label: "Opportunity Discovery", href: "/platform/opportunity-discovery", blurb: "Foundation, corporate and government sources in one feed." },
  { label: "AI Grant Writer", href: "/platform/ai-grant-writer", blurb: "Drafts from your knowledge base with source citations." },
  { label: "AutoApply", href: "/platform/autoapply", blurb: "Fills and submits portals under human approval." },
  { label: "Pipeline and CRM", href: "/platform/pipeline-crm", blurb: "Every prospect, stage and deadline in one place." },
  { label: "Analytics", href: "/platform/analytics", blurb: "Win rate, time saved, dollars pursued." },
]};
export const SOLUTIONS: NavGroup = { label: "Solutions", href: "/solutions", items: [
  { label: "Faith-Based Organizations", href: "/solutions/faith-based" },
  { label: "Human Services", href: "/solutions/human-services" },
  { label: "Housing", href: "/solutions/housing" },
  { label: "Veterans Organizations", href: "/solutions/veterans" },
  { label: "Education", href: "/solutions/education" },
  { label: "Community Development", href: "/solutions/community-development" },
  { label: "Nonprofit Funding Software", href: "/solutions/nonprofit-funding-software" },
  { label: "Grant Discovery Software", href: "/solutions/grant-discovery-software" },
  { label: "Grant Matching Software", href: "/solutions/grant-matching-software" },
  { label: "AI Grant Writing Software", href: "/solutions/ai-grant-writing-software" },
  { label: "Grant Application Automation", href: "/solutions/grant-application-automation" },
  { label: "Nonprofit Funding Pipeline Software", href: "/solutions/funding-pipeline-software" },
  { label: "Corporate Giving Database", href: "/solutions/corporate-giving-database" },
  { label: "Corporate Donation Application Software", href: "/solutions/corporate-donation-application-software" },
  { label: "Nonprofit Prospect Research", href: "/solutions/nonprofit-prospect-research" },
  { label: "Donor Prospecting Intelligence", href: "/solutions/donor-prospecting-intelligence" },
  { label: "Nonprofit Outreach Automation", href: "/solutions/nonprofit-outreach-automation" },
  { label: "Grant Deadline Tracking", href: "/solutions/grant-deadline-tracking" },
  { label: "Human-in-the-Loop AI", href: "/solutions/human-in-the-loop-ai" },
  { label: "Autonomous Fundraising Platform", href: "/solutions/autonomous-fundraising-platform" },
  { label: "Funding Operations Software", href: "/solutions/funding-operations-software" },
]};
export const RESOURCES: NavGroup = { label: "Resources", href: "/resources", items: [
  { label: "Library", href: "/resources" },
  { label: "Ask Benavora", href: "/resources#ask" },
]};
export const TOP_LINKS: NavLink[] = [
  { label: "How It Works", href: "/how-it-works" },
  { label: "Agents", href: "/agents" },
  { label: "Why Benavora", href: "/why-benavora" },
  { label: "Pricing", href: "/pricing" },
];
export const FOOTER_COLUMNS: { heading: string; links: NavLink[] }[] = [
  { heading: "Platform", links: PLATFORM.items },
  { heading: "Solutions", links: SOLUTIONS.items },
  { heading: "Company", links: [
    { label: "Trust and Governance", href: "/trust" },
    { label: "Company", href: "/company" },
    { label: "Book a Demo", href: "/demo" },
    { label: "Privacy", href: "/privacy" },
    { label: "Terms", href: "/terms" },
    { label: "Security", href: "/security" },
  ]},
];
export const ALL_MARKETING_ROUTES: string[] = ["/","/platform",...PLATFORM.items.map(i=>i.href),"/platform/prospect-intelligence","/how-it-works","/agents","/solutions",...SOLUTIONS.items.map(i=>i.href),"/why-benavora","/trust","/pricing","/company","/resources","/demo","/tour","/scan"];
