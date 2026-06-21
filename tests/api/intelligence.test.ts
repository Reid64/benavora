/**
 * Unit tests for intelligence API routes.
 *
 * Routes covered:
 *   POST /api/intelligence/ingest       (src/app/api/intelligence/ingest/route.ts)
 *   POST /api/intelligence/logic-model  (src/app/api/intelligence/logic-model/route.ts)
 *
 * ingest uses requireRole("writer") then a second auth.getUser() check via
 * createClient(). logic-model uses createClient() directly (no requireRole).
 * Both AI calls (extractSections, generateEmbedding, generateLogicModel) are
 * stubbed so no network is needed.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// ── module mocks (hoisted before imports) ─────────────────────────────────────

const mockRequireRole = vi.fn();
vi.mock("@/lib/auth/role-gate", () => ({
  requireRole: (...args: unknown[]) => mockRequireRole(...args),
}));

const mockExtractSections = vi.fn().mockResolvedValue({
  narrative: "Program narrative content here.",
  budget: "Budget overview section.",
});
vi.mock("@/lib/intelligence/section-extractor", () => ({
  extractSections: (...args: unknown[]) => mockExtractSections(...args),
}));

const mockGenerateEmbedding = vi.fn().mockResolvedValue([0.1, 0.2, 0.3]);
vi.mock("@/lib/intelligence/embeddings", () => ({
  generateEmbedding: (...args: unknown[]) => mockGenerateEmbedding(...args),
}));

const mockIngestNih = vi.fn().mockResolvedValue({ ingested: 5 });
vi.mock("@/lib/intelligence/ingest-nih-proposals", () => ({
  ingestNihProposals: () => mockIngestNih(),
}));

const mockGenerateLogicModel = vi.fn().mockResolvedValue({
  category: "housing",
  inputs: ["Staff", "Funding"],
  activities: ["Outreach", "Case management"],
  outputs: ["Clients served"],
  outcomes: ["Stable housing"],
  impact: "Reduced homelessness",
});
vi.mock("@/lib/intelligence/logic-model-generator", () => ({
  generateLogicModel: (...args: unknown[]) => mockGenerateLogicModel(...args),
}));

// createClient — per-test via mockCreateClient.
const mockCreateClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => mockCreateClient(),
}));

// createAdminClient — used by logic-model when save_to_library=true.
const mockAdminInsert = vi.fn().mockResolvedValue({ data: null, error: null });
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: vi.fn().mockReturnValue({ insert: mockAdminInsert }),
  }),
}));

// ── import route handlers AFTER mocks ─────────────────────────────────────────

import { POST as ingestPost } from "@/app/api/intelligence/ingest/route";
import { POST as logicModelPost } from "@/app/api/intelligence/logic-model/route";

// ── constants & helpers ───────────────────────────────────────────────────────

const ORG_ID = "org-intel-test";
const USER_ID = "user-intel-test";

function unauthError() {
  return {
    error: NextResponse.json(
      { error: "Authentication required.", code: "unauthenticated" },
      { status: 401 },
    ),
  };
}

function makeWriterGate() {
  return { supabase: {}, userId: USER_ID, userRole: "writer" as const, organizationId: ORG_ID };
}

/**
 * Build a Supabase client mock where auth.getUser() returns user and each
 * table call is configured via the tableMap argument. Keys are table names;
 * values are the resolved data for `.single()` / `.insert()`.
 */
function makeSupabaseClient({
  user = { id: USER_ID } as { id: string } | null,
  tableMap = {} as Record<string, unknown>,
} = {}) {
  function makeChain(result: unknown) {
    const chain: Record<string, unknown> = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue(result),
      maybeSingle: vi.fn().mockResolvedValue(result),
      insert: vi.fn().mockReturnThis(),
      then: (
        resolve: (v: unknown) => unknown,
        _reject?: (e: unknown) => unknown,
      ) => Promise.resolve(resolve(result)),
    };
    return chain;
  }

  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({ data: { user }, error: null }),
    },
    from: vi.fn((table: string) => {
      const result = table in tableMap
        ? tableMap[table]
        : { data: null, error: null };
      return makeChain(result);
    }),
  };
}

function jsonPost(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── POST /api/intelligence/ingest ────────────────────────────────────────────

describe("POST /api/intelligence/ingest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: requireRole passes, valid user returned by createClient.
    mockRequireRole.mockResolvedValue(makeWriterGate());
    mockCreateClient.mockReturnValue(
      makeSupabaseClient({
        user: { id: USER_ID },
        tableMap: {
          intelligence_funded_proposals: { data: { id: "proposal-1" }, error: null },
          intelligence_proposal_sections: { data: null, error: null },
        },
      }),
    );
    mockExtractSections.mockResolvedValue({ narrative: "Program text." });
    mockGenerateEmbedding.mockResolvedValue([0.1, 0.2, 0.3]);
  });

  it("returns 401 when requireRole rejects the caller", async () => {
    mockRequireRole.mockResolvedValue(unauthError());
    const res = await ingestPost(
      jsonPost("http://localhost/api/intelligence/ingest", {
        source: "manual",
        text: "Some grant text",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("returns 400 for an invalid source value", async () => {
    const res = await ingestPost(
      jsonPost("http://localhost/api/intelligence/ingest", {
        source: "unsupported_source",
        text: "some text",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("invalid_source");
  });

  it("returns 400 when source=manual and text is absent", async () => {
    const res = await ingestPost(
      jsonPost("http://localhost/api/intelligence/ingest", { source: "manual" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_text");
  });

  it("returns 400 when source=url and url is absent", async () => {
    const res = await ingestPost(
      jsonPost("http://localhost/api/intelligence/ingest", { source: "url" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_url");
  });

  it("returns 422 when extractSections returns no usable sections", async () => {
    mockExtractSections.mockResolvedValue({});
    const res = await ingestPost(
      jsonPost("http://localhost/api/intelligence/ingest", {
        source: "manual",
        text: "Irrelevant content with no structured sections.",
      }),
    );
    expect(res.status).toBe(422);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("extraction_failed");
  });

  it("ingests manual text and returns proposal_id with sections_extracted", async () => {
    const res = await ingestPost(
      jsonPost("http://localhost/api/intelligence/ingest", {
        source: "manual",
        text: "This is a detailed grant proposal narrative describing our housing program.",
        metadata: { funder_name: "HUD", award_year: 2024 },
      }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      proposal_id: string;
      sections_extracted: number;
    };
    expect(body.success).toBe(true);
    expect(body.proposal_id).toBe("proposal-1");
    expect(body.sections_extracted).toBeGreaterThan(0);
  });

  it("invokes ingestNihProposals and returns its result for source=nih", async () => {
    const res = await ingestPost(
      jsonPost("http://localhost/api/intelligence/ingest", { source: "nih" }),
    );
    expect(res.status).toBe(200);
    expect(mockIngestNih).toHaveBeenCalled();
    const body = (await res.json()) as { ingested: number };
    expect(body.ingested).toBe(5);
  });
});

// ── POST /api/intelligence/logic-model ────────────────────────────────────────

describe("POST /api/intelligence/logic-model", () => {
  const VALID_BODY = {
    category: "housing",
    program_description: "Emergency shelter for families in rural Texas.",
    organization_id: ORG_ID,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: authenticated user belonging to the correct org.
    mockCreateClient.mockReturnValue(
      makeSupabaseClient({
        user: { id: USER_ID },
        tableMap: {
          profiles: { data: { organization_id: ORG_ID }, error: null },
          organizations: { data: { name: "Reid's Faith Foundation" }, error: null },
        },
      }),
    );
    mockGenerateLogicModel.mockResolvedValue({
      category: "housing",
      inputs: ["Staff"],
      activities: ["Outreach"],
      outputs: ["Clients served"],
      outcomes: ["Stable housing"],
      impact: "Reduced homelessness",
    });
  });

  it("returns 401 when no authenticated user", async () => {
    mockCreateClient.mockReturnValue(makeSupabaseClient({ user: null }));
    const res = await logicModelPost(jsonPost("http://localhost/api/intelligence/logic-model", VALID_BODY));
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("unauthenticated");
  });

  it("returns 400 when category is absent", async () => {
    const res = await logicModelPost(
      jsonPost("http://localhost/api/intelligence/logic-model", {
        program_description: "Housing program",
        organization_id: ORG_ID,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_category");
  });

  it("returns 400 when program_description is absent", async () => {
    const res = await logicModelPost(
      jsonPost("http://localhost/api/intelligence/logic-model", {
        category: "housing",
        organization_id: ORG_ID,
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_program_description");
  });

  it("returns 400 when organization_id is absent", async () => {
    const res = await logicModelPost(
      jsonPost("http://localhost/api/intelligence/logic-model", {
        category: "housing",
        program_description: "Housing program",
      }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("missing_organization_id");
  });

  it("returns 403 when user does not belong to the requested org", async () => {
    mockCreateClient.mockReturnValue(
      makeSupabaseClient({
        user: { id: USER_ID },
        tableMap: {
          // Profile returns a different org — access denied.
          profiles: { data: { organization_id: "other-org-id" }, error: null },
          organizations: { data: { name: "Other Org" }, error: null },
        },
      }),
    );
    const res = await logicModelPost(
      jsonPost("http://localhost/api/intelligence/logic-model", VALID_BODY),
    );
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("forbidden");
  });

  it("generates and returns a logic model with success=true", async () => {
    const res = await logicModelPost(
      jsonPost("http://localhost/api/intelligence/logic-model", VALID_BODY),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      logic_model: { category: string; inputs: string[] };
    };
    expect(body.success).toBe(true);
    expect(body.logic_model.category).toBe("housing");
    expect(Array.isArray(body.logic_model.inputs)).toBe(true);
    expect(mockGenerateLogicModel).toHaveBeenCalledWith(
      expect.objectContaining({
        category: "housing",
        programDescription: VALID_BODY.program_description,
        organizationName: "Reid's Faith Foundation",
      }),
    );
  });

  it("saves the model to the library when save_to_library=true", async () => {
    const res = await logicModelPost(
      jsonPost("http://localhost/api/intelligence/logic-model", {
        ...VALID_BODY,
        save_to_library: true,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockAdminInsert).toHaveBeenCalled();
  });

  it("does not call admin insert when save_to_library is absent", async () => {
    const res = await logicModelPost(
      jsonPost("http://localhost/api/intelligence/logic-model", VALID_BODY),
    );
    expect(res.status).toBe(200);
    expect(mockAdminInsert).not.toHaveBeenCalled();
  });
});
