import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { EmailComplianceEngine } from "@/lib/admin/compliance";

const engine = new EmailComplianceEngine();

const COMPLIANT_EMAIL = {
  from: '"Benavora Team" <outreach@benavora.com>',
  to: "funder@example.com",
  subject: "Grant Funding Partnership",
  body_html:
    "<p>Hello.</p>" +
    "<p>123 Main Street, Suite 100</p>" +
    '<a href="https://benavora.com/unsubscribe?email=x&token=y">Unsubscribe</a>',
};

describe("EmailComplianceEngine.enforceCompliance", () => {
  it("rejects deceptive subject starting with RE:", () => {
    const result = engine.enforceCompliance({
      ...COMPLIANT_EMAIL,
      subject: "RE: Our last conversation",
    });
    expect(result.compliant).toBe(false);
    expect(result.violations.some((v) => v.includes("RE:/FW:"))).toBe(true);
  });

  it("rejects deceptive subject starting with FW:", () => {
    const result = engine.enforceCompliance({
      ...COMPLIANT_EMAIL,
      subject: "FW: Important update",
    });
    expect(result.compliant).toBe(false);
    expect(result.violations.some((v) => v.includes("RE:/FW:"))).toBe(true);
  });

  it("adds unsubscribe link if missing and returns modified_body", () => {
    const result = engine.enforceCompliance({
      ...COMPLIANT_EMAIL,
      body_html: "<p>Hello.</p><p>123 Main Street, Suite 100</p>",
    });
    expect(result.compliant).toBe(false);
    expect(result.violations.some((v) => v.includes("unsubscribe"))).toBe(true);
    expect(result.modified_body).toBeDefined();
    expect(result.modified_body).toContain("benavora.com/unsubscribe");
  });

  it("adds physical address if missing and returns modified_body", () => {
    const result = engine.enforceCompliance({
      ...COMPLIANT_EMAIL,
      body_html:
        "<p>Hello.</p>" +
        '<a href="https://benavora.com/unsubscribe?email=x&token=y">Unsubscribe</a>',
    });
    expect(result.compliant).toBe(false);
    expect(result.violations.some((v) => v.includes("physical mailing address"))).toBe(true);
    expect(result.modified_body).toBeDefined();
    expect(result.modified_body).toContain("123 Main Street");
  });

  it("compliant email passes all checks with no violations", () => {
    const result = engine.enforceCompliance(COMPLIANT_EMAIL);
    expect(result.compliant).toBe(true);
    expect(result.violations).toHaveLength(0);
    expect(result.modified_body).toBeUndefined();
  });
});

describe("EmailComplianceEngine unsubscribe token", () => {
  it("generateUnsubscribeToken/verifyUnsubscribeToken round-trips", () => {
    const email = "test@example.com";
    const token = engine.generateUnsubscribeToken(email);
    expect(engine.verifyUnsubscribeToken(email, token)).toBe(true);
  });

  it("fails verification with a wrong token", () => {
    expect(engine.verifyUnsubscribeToken("test@example.com", "notthetoken")).toBe(false);
  });

  it("normalises email to lowercase before hashing", () => {
    const token = engine.generateUnsubscribeToken("user@test.com");
    expect(engine.verifyUnsubscribeToken("USER@TEST.COM", token)).toBe(true);
  });
});
