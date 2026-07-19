"use strict";
// App-wide constants. Enum string values mirror SCHEMA_REGISTRY.md exactly.
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIER_PLANS = exports.AI_RATE_LIMIT_PER_MINUTE = exports.USAGE_METRICS = exports.TIER_LIMITS = exports.SUBSCRIPTION_TIERS = exports.MIN_USES_FOR_RETIREMENT = exports.RETIREMENT_EFFECTIVENESS_THRESHOLD = exports.PROVEN_NARRATIVE_THRESHOLD = exports.MIN_OUTCOMES_FOR_RATE = exports.MAX_OUTREACH_EMAILS_PER_DAY = exports.MIN_CAMPAIGN_STEP_GAP_DAYS = exports.CAMPAIGN_STATUSES = exports.GIVING_LIKELIHOODS = exports.OUTREACH_STATUSES = exports.OUTCOME_RESULTS = exports.PROGRAM_STATUSES = exports.NARRATIVE_MIN_CONTENT_LENGTH = exports.NARRATIVE_CATEGORIES = exports.STANDARD_ANSWER_CATEGORY = exports.KNOWLEDGE_BASE_CATEGORIES = exports.AI_CONFIDENCE_THRESHOLD = exports.ALLOWED_UPLOAD_EXTENSIONS = exports.MAX_UPLOAD_BYTES = exports.DOCUMENT_CATEGORIES = exports.CONTACT_METHODS = exports.CONTACT_RELATIONSHIPS = exports.ROLE_HIERARCHY = exports.USER_ROLES = exports.OPPORTUNITY_RECURRENCES = exports.OPPORTUNITY_SOURCE_TYPES = exports.OPPORTUNITY_STATUSES = exports.PIPELINE_STAGES = exports.FUNDER_CATEGORIES = exports.APP_NAME = void 0;
exports.hasRequiredRole = hasRequiredRole;
exports.APP_NAME = "Benavora";
exports.FUNDER_CATEGORIES = [
    "corporate_donation",
    "corporate_sponsorship",
    "corporate_foundation",
    "private_foundation",
    "government_grant",
    "local_community_grant",
    "housing_grant",
    "education_grant",
    "faith_compatible_grant",
    "in_kind_donation",
    "materials_donation",
    "down_payment_assistance",
];
exports.PIPELINE_STAGES = [
    "discovered",
    "eligibility_review",
    "qualified",
    "drafting",
    "awaiting_documents",
    "ready_for_review",
    "submitted",
    "follow_up_due",
    "awarded",
    "denied",
    "reporting_required",
    "renewal_opportunity",
];
// Opportunity status lifecycle (Behavioral Contracts §5). open → applied →
// closed/expired. Mirrors the opportunity_status enum.
exports.OPPORTUNITY_STATUSES = [
    "open",
    "applied",
    "closed",
    "expired",
];
// Funding-SOURCE classification (migration 010 opportunity_source_type enum). A
// coarse "where the money comes from" bucket, distinct from the fine-grained
// funder `category`. Powers the Opportunities source filter tabs + color-coded
// badges and is auto-assigned by the research agents on discovery. NOT in
// SCHEMA_REGISTRY - added by the live build (migration 010); see
// STATE_OF_THE_BUILD.md. (Unrelated to the grants API's contract `source_type`,
// which aliases `category`.)
exports.OPPORTUNITY_SOURCE_TYPES = [
    "government_federal",
    "government_state",
    "government_local",
    "private_foundation",
    "corporate_giving",
    "community_foundation",
    "faith_based",
    "international",
];
// Recurrence patterns for opportunities (SCHEMA_REGISTRY opportunities.recurrence).
exports.OPPORTUNITY_RECURRENCES = [
    "one_time",
    "annual",
    "quarterly",
    "rolling",
];
exports.USER_ROLES = ["owner", "admin", "writer", "viewer"];
// Role hierarchy: owner > admin > writer > viewer (BLUEPRINT §3.2). Higher rank =
// more privilege. Defined here (a client-safe module) so the server gate
// (src/lib/auth/role-gate.ts) and any client components share one source of
// truth without pulling server-only code into the bundle.
exports.ROLE_HIERARCHY = {
    owner: 4,
    admin: 3,
    writer: 2,
    viewer: 1,
};
/** True if `role` meets or exceeds `requiredRole` in the hierarchy. */
function hasRequiredRole(role, requiredRole) {
    if (!role)
        return false;
    return exports.ROLE_HIERARCHY[role] >= exports.ROLE_HIERARCHY[requiredRole];
}
// Contact relationship stages (Behavioral Contracts §4). Ordered cold → warm →
// active → champion; the order doubles as the forward-progression sequence.
exports.CONTACT_RELATIONSHIPS = [
    "cold",
    "warm",
    "active",
    "champion",
];
// Common ways to reach a contact. Free-form in the schema; these cover the
// usual cases and are humanized for display.
exports.CONTACT_METHODS = [
    "email",
    "phone",
    "text",
    "mail",
    "in_person",
];
// Document categories (SCHEMA_REGISTRY document_category enum / BLUEPRINT §4.6).
exports.DOCUMENT_CATEGORIES = [
    "tax_documents",
    "legal_documents",
    "financial_documents",
    "program_documents",
    "marketing_materials",
    "letters_of_support",
    "application_attachments",
    "photos",
];
// Document upload limits (Behavioral Contracts §7).
exports.MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
exports.ALLOWED_UPLOAD_EXTENSIONS = [
    "pdf",
    "doc",
    "docx",
    "jpg",
    "jpeg",
    "png",
    "xls",
    "xlsx",
    "txt",
];
// AI confidence threshold below which a draft shows a warning banner.
exports.AI_CONFIDENCE_THRESHOLD = 70;
// Knowledge base categories (SCHEMA_REGISTRY knowledge_base_category enum).
exports.KNOWLEDGE_BASE_CATEGORIES = [
    "mission",
    "vision",
    "need_statement",
    "program_description",
    "impact",
    "capacity",
    "sustainability",
    "partnerships",
    "budget_justification",
    "organizational_history",
    "custom",
];
// The knowledge_base table stores both reusable narratives and standard answers
// (BLUEPRINT §4.7). The schema has no flag separating them, so we use the
// category convention: the "custom" category is reserved for FAQ-style standard
// answers (title = question pattern, content = approved answer); every other
// category is a reusable narrative block. BLUEPRINT's narrative category list
// intentionally excludes "custom", so this mapping stays faithful to the spec.
exports.STANDARD_ANSWER_CATEGORY = "custom";
exports.NARRATIVE_CATEGORIES = exports.KNOWLEDGE_BASE_CATEGORIES.filter((category) => category !== exports.STANDARD_ANSWER_CATEGORY);
// Minimum narrative content length (Behavioral Contracts §8).
exports.NARRATIVE_MIN_CONTENT_LENGTH = 50;
// Program lifecycle states (SCHEMA_REGISTRY programs.status).
exports.PROGRAM_STATUSES = ["active", "planned", "completed"];
// Outcome results (SCHEMA_REGISTRY outcome_result enum / BLUEPRINT §4.10).
exports.OUTCOME_RESULTS = ["awarded", "denied", "partial"];
// Cold outreach (BLUEPRINT §4.11 / Behavioral Contracts §13). outreach_contacts
// statuses are free-form in the schema; these are the lifecycle values the UI
// uses. "converted" is set by the Convert-to-Funder action, never re-entered.
exports.OUTREACH_STATUSES = [
    "new",
    "contacted",
    "responded",
    "converted",
    "unresponsive",
];
// Giving-likelihood buckets the Cold Outreach Agent assigns (AGENTS.md Agent 11).
exports.GIVING_LIKELIHOODS = ["high", "medium", "low"];
// Email campaign lifecycle (SCHEMA_REGISTRY campaign_status enum / BLUEPRINT §4.11).
exports.CAMPAIGN_STATUSES = [
    "draft",
    "active",
    "paused",
    "completed",
];
// Anti-spam guards on campaigns (Behavioral Contracts §13).
exports.MIN_CAMPAIGN_STEP_GAP_DAYS = 1;
exports.MAX_OUTREACH_EMAILS_PER_DAY = 50;
// Recursive learning thresholds. Mirror the per-organization platform_config
// flags seeded in SCHEMA_REGISTRY (learning.* keys) and Behavioral Contracts §10.
//
// Minimum outcomes in a category before a success-rate percentage is shown -
// below this we display "Insufficient data" rather than a misleading rate
// (learning.min_outcomes_for_scoring, Contracts §10).
exports.MIN_OUTCOMES_FOR_RATE = 5;
// Awarded uses a narrative needs before its source KB entry earns is_proven
// (learning.proven_narrative_threshold, Contracts §8/§10).
exports.PROVEN_NARRATIVE_THRESHOLD = 2;
// A narrative with effectiveness below this after MIN_USES_FOR_RETIREMENT total
// uses is flagged for retirement review (Contracts §10).
exports.RETIREMENT_EFFECTIVENESS_THRESHOLD = 0.3;
exports.MIN_USES_FOR_RETIREMENT = 5;
// ---------------------------------------------------------------------------
// Billing - Stripe subscription tiers (BLUEPRINT Phase 5 / SCHEMA_REGISTRY
// subscription_tier enum). Mirrors the "Tier Limits" table in BLUEPRINT exactly.
// ---------------------------------------------------------------------------
// Subscription tiers, ascending. Mirrors the subscription_tier enum.
exports.SUBSCRIPTION_TIERS = [
    "free",
    "starter",
    "professional",
    "enterprise",
    "consultant",
];
/**
 * Per-tier hard limits enforced server-side (Behavioral Contracts §25). Values
 * mirror the BLUEPRINT "Tier Limits" table. storage is in megabytes.
 *
 * `email_sends_per_day` comes straight from BLUEPRINT (Free 0 / Starter 25 /
 * Professional 50 / Enterprise 200). `api_calls_per_day` is NOT specified by
 * BLUEPRINT - it's a derived daily ceiling for the AI endpoints, scaled per
 * tier. The per-minute burst guard (AI_RATE_LIMIT_PER_MINUTE, Contracts §16)
 * remains the primary protection; this daily cap is the metered usage limit.
 */
exports.TIER_LIMITS = {
    free: {
        agent_runs_per_day: 10,
        storage_mb: 100,
        users: 2,
        search_profiles: 3,
        email_sends_per_day: 0,
        api_calls_per_day: 200,
    },
    starter: {
        agent_runs_per_day: 50,
        storage_mb: 500,
        users: 5,
        search_profiles: 10,
        email_sends_per_day: 25,
        api_calls_per_day: 1000,
    },
    professional: {
        agent_runs_per_day: 200,
        storage_mb: 2000,
        users: 15,
        search_profiles: 25,
        email_sends_per_day: 50,
        api_calls_per_day: 5000,
    },
    enterprise: {
        agent_runs_per_day: 1000,
        storage_mb: 10000,
        users: 50,
        search_profiles: 100,
        email_sends_per_day: 200,
        api_calls_per_day: 20000,
    },
    consultant: {
        agent_runs_per_day: 5000,
        storage_mb: 50000,
        users: 200,
        search_profiles: 500,
        email_sends_per_day: 500,
        api_calls_per_day: 100000,
    },
};
// Metered usage counters (SCHEMA_REGISTRY usage_metrics.metric_name / Contracts
// §25). Daily counters reset at midnight UTC; storage_bytes is cumulative and is
// computed live from documents.file_size rather than a daily counter.
exports.USAGE_METRICS = [
    "agent_runs",
    "api_calls",
    "email_sends",
    "storage_bytes",
];
// Per-org burst guard on the AI endpoints (Behavioral Contracts §16): 20
// requests per minute. Enforced in-process per server instance, alongside the
// metered daily api_calls cap from TIER_LIMITS.
exports.AI_RATE_LIMIT_PER_MINUTE = 20;
/**
 * Display metadata for each tier (BLUEPRINT Phase 5 pricing). `priceEnvVar` is
 * the server env var holding that tier's Stripe Price ID; the free tier has no
 * Stripe price (no billing - Contracts §22). Prices are monthly USD.
 */
exports.TIER_PLANS = {
    free: {
        name: "Free",
        monthlyPrice: 0,
        priceEnvVar: null,
        tagline: "Get started at no cost",
        features: [
            "10 agent runs/day",
            "100 MB storage",
            "2 users",
            "3 search profiles",
        ],
    },
    starter: {
        name: "Starter",
        monthlyPrice: 149,
        priceEnvVar: "STRIPE_STARTER_PRICE_ID",
        tagline: "For small teams getting going",
        features: [
            "50 agent runs/day",
            "500 MB storage",
            "5 users",
            "10 search profiles",
            "Browser automation",
            "25 outreach emails/day",
        ],
    },
    professional: {
        name: "Professional",
        monthlyPrice: 299,
        priceEnvVar: "STRIPE_PROFESSIONAL_PRICE_ID",
        tagline: "For growing organizations",
        features: [
            "200 agent runs/day",
            "2 GB storage",
            "15 users",
            "25 search profiles",
            "Browser automation",
            "50 outreach emails/day",
            "Priority support",
        ],
    },
    enterprise: {
        name: "Enterprise",
        monthlyPrice: 499,
        priceEnvVar: "STRIPE_ENTERPRISE_PRICE_ID",
        tagline: "For established nonprofits at scale",
        features: [
            "1,000 agent runs/day",
            "10 GB storage",
            "50 users",
            "100 search profiles",
            "Browser automation",
            "200 outreach emails/day",
            "Priority support",
        ],
    },
    consultant: {
        name: "Consultant",
        monthlyPrice: 799,
        priceEnvVar: "STRIPE_CONSULTANT_PRICE_ID",
        tagline: "For consultants managing multiple nonprofits",
        features: [
            "5,000 agent runs/day",
            "50 GB storage",
            "200 users",
            "500 search profiles",
            "White-label reports",
            "500 outreach emails/day",
            "Dedicated account manager",
            "API access",
        ],
    },
};
