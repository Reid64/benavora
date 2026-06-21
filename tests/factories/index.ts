import type { Tables } from "@/types/database";

const ORG_ID = "test-org-id-1";
const USER_ID = "test-user-id-1";
const FUNDER_ID = "test-funder-id-1";
const OPP_ID = "test-opp-id-1";
const APP_ID = "test-app-id-1";
const NOW = "2026-01-01T00:00:00.000Z";

export function createMockOrganization(
  overrides?: Partial<Tables<"organizations">>
): Tables<"organizations"> {
  return {
    id: ORG_ID,
    name: "Test Nonprofit Org",
    dba: null,
    ein: "12-3456789",
    tax_status: "501(c)(3)",
    mission_statement: "To serve our community.",
    vision_statement: null,
    founding_date: "2010-01-01",
    founder_name: "Jane Doe",
    founder_bio: null,
    service_area: "Local",
    target_population: "Low-income families",
    annual_budget: 500000,
    total_staff: 10,
    total_volunteers: 50,
    website: "https://testorg.example.com",
    phone: "555-555-5555",
    email: "contact@testorg.example.com",
    address_line1: "123 Main St",
    address_line2: null,
    city: "Testville",
    state: "CA",
    zip: "90210",
    logo_url: null,
    stripe_customer_id: null,
    subscription_tier: "starter",
    onboarding_completed: true,
    onboarding_completed_at: NOW,
    onboarding_step: 5,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createMockProfile(
  overrides?: Partial<Tables<"profiles">>
): Tables<"profiles"> {
  return {
    id: USER_ID,
    organization_id: ORG_ID,
    email: "owner@testorg.example.com",
    full_name: "Jane Doe",
    role: "owner",
    avatar_url: null,
    last_login_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createMockFunder(
  overrides?: Partial<Tables<"funders">>
): Tables<"funders"> {
  return {
    id: FUNDER_ID,
    organization_id: ORG_ID,
    name: "Test Foundation",
    category: "private_foundation",
    description: "A private foundation supporting nonprofits.",
    website: "https://testfoundation.example.com",
    giving_portal_url: null,
    portal_login_status: null,
    annual_giving_budget: 1000000,
    geographic_focus: "California",
    preferred_application_method: "online",
    has_giving_page: true,
    portal_status: null,
    portal_last_checked_at: null,
    portal_response_time_ms: null,
    portal_review_status: null,
    automation_level: null,
    automation_notes: null,
    notes: null,
    last_contacted_at: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createMockOpportunity(
  overrides?: Partial<Tables<"opportunities">>
): Tables<"opportunities"> {
  return {
    id: OPP_ID,
    organization_id: ORG_ID,
    funder_id: FUNDER_ID,
    name: "Community Development Grant",
    category: "private_foundation",
    description: "Grant for community development projects.",
    amount_available: 50000,
    amount_min: 10000,
    amount_max: 50000,
    deadline: "2026-06-30",
    url: "https://testfoundation.example.com/apply",
    eligibility_requirements: "501(c)(3) status required.",
    required_documents: ["501c3 letter", "budget"],
    application_method: "online",
    recurrence: "annual",
    geographic_restrictions: "California only",
    opportunity_documents: null,
    eligibility_score: 85,
    recommendation: "apply",
    recommendation_reasoning: "Strong mission alignment.",
    match_percentage: 85,
    is_high_priority: true,
    match_mismatch_reasons: null,
    status: "open",
    source: "foundation website",
    source_type: "private_foundation",
    discovered_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createMockApplication(
  overrides?: Partial<Tables<"applications">>
): Tables<"applications"> {
  return {
    id: APP_ID,
    organization_id: ORG_ID,
    opportunity_id: OPP_ID,
    stage: "drafting",
    assigned_user_id: USER_ID,
    requested_amount: 25000,
    submitted_at: null,
    awarded_amount: null,
    draft_content: null,
    draft_template_type: "grant_narrative",
    draft_confidence_score: null,
    draft_knowledge_sources: null,
    notes: null,
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createMockDraft(
  overrides?: Partial<Tables<"draft_versions">>
): Tables<"draft_versions"> {
  return {
    id: "test-draft-id-1",
    organization_id: ORG_ID,
    opportunity_id: OPP_ID,
    application_id: APP_ID,
    template_type: "grant_narrative",
    content: "This is a mock grant narrative draft.",
    confidence_score: 80,
    knowledge_sources: null,
    version_number: 1,
    humanization_status: "not_humanized",
    source: "ai_generated",
    created_by: USER_ID,
    created_at: NOW,
    ...overrides,
  };
}

export function createMockEmailConnection(
  overrides?: Partial<Tables<"email_connections">>
): Tables<"email_connections"> {
  return {
    id: "test-email-conn-id-1",
    organization_id: ORG_ID,
    user_id: USER_ID,
    provider: "google",
    email_address: "owner@testorg.example.com",
    access_token_encrypted: null,
    refresh_token_encrypted: null,
    token_expires_at: null,
    sync_status: "active",
    last_sync_at: NOW,
    sync_cursor: null,
    scopes: ["https://www.googleapis.com/auth/gmail.readonly"],
    created_at: NOW,
    updated_at: NOW,
    ...overrides,
  };
}

export function createMockProspect(
  overrides?: Partial<Tables<"prospects">>
): Tables<"prospects"> {
  return {
    id: "test-prospect-id-1",
    list_id: null,
    ein: "98-7654321",
    org_name: "Prospect Nonprofit Inc.",
    org_type: "nonprofit",
    email: "info@prospect.example.com",
    website: "https://prospect.example.com",
    city: "Los Angeles",
    state: "CA",
    zip: "90001",
    annual_revenue: 200000,
    employee_count: 5,
    ntee_code: "B20",
    subsection_code: "03",
    status: "new",
    suppressed: false,
    suppressed_reason: null,
    suppressed_at: null,
    last_contacted_at: null,
    total_emails_sent: 0,
    has_replied: false,
    has_converted: false,
    converted_org_id: null,
    created_at: NOW,
    ...overrides,
  };
}
