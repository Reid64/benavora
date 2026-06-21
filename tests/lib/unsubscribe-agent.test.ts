/**
 * Unit tests for the UnsubscribeAgent.
 *
 * Tests:
 *   classifyReply — intent detection for unsubscribe, positive, and auto_reply
 *   processIncomingReply — suppression workflow on unsubscribe
 *   processIncomingReply — sequence pause on positive reply
 */

import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock("server-only", () => ({}));

const { mockMessagesCreate, mockAdminFrom } = vi.hoisted(() => ({
  mockMessagesCreate: vi.fn(),
  mockAdminFrom: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: vi.fn().mockImplementation(() => ({
    messages: { create: mockMessagesCreate },
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn().mockReturnValue({ from: mockAdminFrom }),
}));

// ── Import the agent AFTER mocks ──────────────────────────────────────────────

import { UnsubscribeAgent, type ReplyClassification } from "@/lib/admin/unsubscribe-agent";

// ── Helpers ───────────────────────────────────────────────────────────────────

// Build a thenable Supabase chain where any awaited call resolves with { data, error }.
function makeChain(data: unknown, error: unknown = null) {
  const chain: Record<string, unknown> = {
    then: (
      resolve: (v: unknown) => unknown,
      _reject?: (e: unknown) => unknown,
    ) => Promise.resolve(resolve({ data, error })),
  };
  for (const m of ["select", "eq", "not", "neq", "in", "update", "insert", "upsert"]) {
    chain[m] = vi.fn().mockReturnValue(chain);
  }
  // single() returns its own resolved promise so `await chain.select().eq().single()` works.
  chain["single"] = vi.fn().mockResolvedValue({ data, error });
  return chain;
}

function makeClassification(
  intent: ReplyClassification["intent"],
  confidence = 0.92,
): string {
  return JSON.stringify({ intent, confidence, reasoning: `Test: ${intent}` });
}

function mockAnthropicText(text: string) {
  mockMessagesCreate.mockResolvedValueOnce({
    content: [{ type: "text", text }],
  });
}

// Sample send record returned from the DB
const SEND_ID = "send-abc-001";
const PROSPECT_ID = "prospect-xyz-001";
const SEND_RECORD = {
  id: SEND_ID,
  prospect_id: PROSPECT_ID,
  to_address: "contact@example.com",
  from_address: "outreach@mail.test",
  campaign_id: "camp-001",
};

// Configure mockAdminFrom so from("sales_sends").select().eq().single() returns SEND_RECORD
// and all update/insert chains succeed.
function setupSuccessfulSendLookup() {
  let salesSendsCallCount = 0;
  mockAdminFrom.mockImplementation((table: string) => {
    if (table === "sales_sends") {
      salesSendsCallCount++;
      if (salesSendsCallCount === 1) {
        // First call: select query
        return makeChain(SEND_RECORD);
      }
      // Subsequent calls: update operations
      return makeChain(null);
    }
    if (table === "suppression_list") {
      return makeChain(null); // insert returns no data
    }
    if (table === "prospects") {
      return makeChain(null); // update returns no data
    }
    return makeChain(null);
  });
}

// ── classifyReply tests ───────────────────────────────────────────────────────

describe("UnsubscribeAgent.classifyReply", () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key-vitest";
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('identifies "unsubscribe me" as unsubscribe intent', async () => {
    mockAnthropicText(makeClassification("unsubscribe", 0.98));

    const agent = new UnsubscribeAgent();
    const result = await agent.classifyReply(
      "Please remove me from your list. I do not want to receive any more emails.",
      "Re: Partnering with Your Org",
    );

    expect(result.intent).toBe("unsubscribe");
    expect(result.confidence).toBeGreaterThan(0.7);
    expect(result.reasoning).toBeDefined();
  });

  it('identifies "tell me more" as positive intent', async () => {
    mockAnthropicText(makeClassification("positive", 0.88));

    const agent = new UnsubscribeAgent();
    const result = await agent.classifyReply(
      "This is interesting! We'd love to learn more about your platform.",
      "Re: Partnering with Lone Star Foundation",
    );

    expect(result.intent).toBe("positive");
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  it('identifies "out of office" as auto_reply intent', async () => {
    mockAnthropicText(makeClassification("auto_reply", 0.97));

    const agent = new UnsubscribeAgent();
    const result = await agent.classifyReply(
      "I am out of the office until July 7. For urgent matters please contact support@example.com.",
      "Auto-reply: Out of Office",
    );

    expect(result.intent).toBe("auto_reply");
    expect(result.confidence).toBeGreaterThan(0.8);
  });

  it("strips JSON code fences before parsing", async () => {
    mockMessagesCreate.mockResolvedValueOnce({
      content: [
        {
          type: "text",
          text: '```json\n{"intent":"negative","confidence":0.75,"reasoning":"Complaint"}\n```',
        },
      ],
    });

    const agent = new UnsubscribeAgent();
    const result = await agent.classifyReply("This is spam.", "Re: Outreach");

    expect(result.intent).toBe("negative");
  });

  it("returns classification_failed when Anthropic throws", async () => {
    mockMessagesCreate.mockRejectedValueOnce(new Error("API overloaded"));

    const agent = new UnsubscribeAgent();
    const result = await agent.processIncomingReply(SEND_ID, "error body", "error subject");

    expect(result.success).toBe(false);
    expect(result.action).toBe("classification_failed");
  });
});

// ── processIncomingReply: unsubscribe suppression ─────────────────────────────

describe("UnsubscribeAgent.processIncomingReply — unsubscribe suppresses prospect", () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key-vitest";
    delete process.env.RESEND_API_KEY; // Prevent real HTTP confirmation email
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds email to suppression_list, marks prospect suppressed, and returns action=unsubscribed", async () => {
    setupSuccessfulSendLookup();

    const agent = new UnsubscribeAgent();

    // Spy on classifyReply so we control classification without Anthropic
    vi.spyOn(agent, "classifyReply").mockResolvedValue({
      intent: "unsubscribe",
      confidence: 0.96,
      reasoning: "Explicit unsubscribe request",
    });

    const result = await agent.processIncomingReply(
      SEND_ID,
      "Please remove me from your mailing list.",
      "Re: Outreach",
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("unsubscribed");
    expect(result.classification.intent).toBe("unsubscribe");

    // suppression_list.insert should have been called with the prospect email
    const suppressionInsertCalls = mockAdminFrom.mock.calls.filter(
      (c) => c[0] === "suppression_list",
    );
    expect(suppressionInsertCalls.length).toBeGreaterThanOrEqual(1);
  });

  it("does not suppress when confidence is at or below 0.7", async () => {
    setupSuccessfulSendLookup();

    const agent = new UnsubscribeAgent();
    vi.spyOn(agent, "classifyReply").mockResolvedValue({
      intent: "unsubscribe",
      confidence: 0.65, // Below the 0.7 threshold
      reasoning: "Possibly ambiguous",
    });

    const result = await agent.processIncomingReply(
      SEND_ID,
      "Maybe stop?",
      "Re: Outreach",
    );

    // Should fall through to the generic "classified_unsubscribe" branch
    expect(result.success).toBe(true);
    expect(result.action).toBe("classified_unsubscribe");
  });

  it("returns send_not_found when the send record does not exist", async () => {
    // Simulate missing send
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "sales_sends") {
        return makeChain(null, { message: "Row not found" });
      }
      return makeChain(null);
    });

    const agent = new UnsubscribeAgent();
    vi.spyOn(agent, "classifyReply").mockResolvedValue({
      intent: "unsubscribe",
      confidence: 0.95,
      reasoning: "Explicit",
    });

    const result = await agent.processIncomingReply("missing-id", "Unsub me", "Re:");

    expect(result.success).toBe(false);
    expect(result.action).toBe("send_not_found");
  });
});

// ── processIncomingReply: positive reply pauses sequence ─────────────────────

describe("UnsubscribeAgent.processIncomingReply — positive reply pauses sequence", () => {
  beforeAll(() => {
    process.env.ANTHROPIC_API_KEY = "test-key-vitest";
    delete process.env.RESEND_API_KEY;
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks prospect has_replied, cancels queued sends, stamps send as replied", async () => {
    setupSuccessfulSendLookup();

    const agent = new UnsubscribeAgent();
    vi.spyOn(agent, "classifyReply").mockResolvedValue({
      intent: "positive",
      confidence: 0.91,
      reasoning: "Interested response",
    });

    const result = await agent.processIncomingReply(
      SEND_ID,
      "We'd love to hear more about your platform!",
      "Re: Grant Automation Platform",
    );

    expect(result.success).toBe(true);
    expect(result.action).toContain("positive_reply");
    expect(result.action).toContain(PROSPECT_ID);
    expect(result.classification.intent).toBe("positive");

    // prospects.update({has_replied: true}) should be called
    const prospectCalls = mockAdminFrom.mock.calls.filter(
      (c) => c[0] === "prospects",
    );
    expect(prospectCalls.length).toBeGreaterThanOrEqual(1);

    // sales_sends should be called multiple times (1 select + at least 2 updates)
    const sendCalls = mockAdminFrom.mock.calls.filter(
      (c) => c[0] === "sales_sends",
    );
    expect(sendCalls.length).toBeGreaterThanOrEqual(3);
  });

  it("does NOT add email to suppression_list on positive reply", async () => {
    setupSuccessfulSendLookup();

    const agent = new UnsubscribeAgent();
    vi.spyOn(agent, "classifyReply").mockResolvedValue({
      intent: "positive",
      confidence: 0.89,
      reasoning: "Clear interest",
    });

    await agent.processIncomingReply(SEND_ID, "Interested!", "Re:");

    // suppression_list should NOT be touched for positive replies
    const suppressionCalls = mockAdminFrom.mock.calls.filter(
      (c) => c[0] === "suppression_list",
    );
    expect(suppressionCalls.length).toBe(0);
  });

  it("records reply without suppressing for auto_reply intent", async () => {
    setupSuccessfulSendLookup();

    const agent = new UnsubscribeAgent();
    vi.spyOn(agent, "classifyReply").mockResolvedValue({
      intent: "auto_reply",
      confidence: 0.99,
      reasoning: "Out of office header detected",
    });

    const result = await agent.processIncomingReply(
      SEND_ID,
      "I am out of the office until next week.",
      "Auto-Reply",
    );

    expect(result.success).toBe(true);
    expect(result.action).toBe("classified_auto_reply");

    // suppression_list should NOT be touched
    const suppressionCalls = mockAdminFrom.mock.calls.filter(
      (c) => c[0] === "suppression_list",
    );
    expect(suppressionCalls.length).toBe(0);
  });
});
