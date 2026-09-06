// Shared FAQ content for /pricing — rendered in PricingPageClient.tsx and
// serialized into FAQPage JSON-LD in page.tsx. Kept in one place so the
// visible copy and the structured data can never drift apart.
//
// Every answer is grounded in a real, verified mechanism already elsewhere in
// this codebase (cited inline), not invented marketing copy:
// - "percentage of any grant" answer: the flat-subscription / 2 CFR 200.458
//   compliance note already published on /for-consultants
//   (ForConsultantsClient.tsx).
// - "autonomous submissions" answer: risk-engine.ts's assessSubmissionRisk()
//   gate, already cited on the homepage's CanIControlIt.tsx/CanITrustIt.tsx.
// - "portals" answer, "cancel anytime" answer, "setup time" answer: carried
//   over verbatim from the previous PricingPageClient.tsx FAQ list.
export const PRICING_FAQS: { question: string; answer: string }[] = [
  {
    question: "How long does setup take?",
    answer:
      "Organization profile setup takes about 15 minutes. Your first matched opportunities typically appear within 24 hours, once the nightly discovery run completes.",
  },
  {
    question: "Do I need technical skills?",
    answer:
      "No. Benavora is designed for nonprofit staff, not developers — every workflow is a guided form, not a config file.",
  },
  {
    question: "Is my data secure?",
    answer:
      "Yes. Every organization's data is isolated with Postgres row-level security and encrypted at rest, following SOC 2-aligned practices.",
  },
  {
    question: "Can I cancel anytime?",
    answer:
      "Yes. No long-term contracts. Cancel from your billing page anytime and your access continues through the end of the current billing period.",
  },
  {
    question: "Does AutoApply work on all portals?",
    answer:
      "AutoApply has dedicated adapters for CyberGrants and Benevity, plus AI-driven form analysis for generic corporate giving portals. New named adapters are added as more portals get mapped.",
  },
  {
    question: "Do you take a percentage of any grant or award?",
    answer:
      "No. Every plan is a flat monthly subscription — Benavora never charges a percentage of an award, grant, or donation, and never structures fees as contingent on funding received.",
  },
  {
    question: "What's the difference between the four plans?",
    answer:
      "Starter covers grant discovery, eligibility scoring, and AI-drafted applications for a single organization. Professional adds corporate donor discovery and relationship intelligence for larger pipelines. Enterprise adds fully autonomous operation and white-glove onboarding. Agency is built for consultancies managing multiple client organizations from one workspace.",
  },
  {
    question: "What if I need more than five client workspaces?",
    answer:
      "Agency includes five client workspaces. Agency Scale extends that to up to ten client workspaces on the same multi-client dashboard, at $5,997/mo.",
  },
  {
    question: "Is there a limit on how many autonomous submissions a plan gets?",
    answer:
      "No plan advertises a fixed number of autonomous submissions. Every submission — on every plan — passes through eligibility checks and a risk-based approval gate first; CAPTCHA challenges, high-risk submissions, and first-time funders always pause for a person before anything goes out.",
  },
];
