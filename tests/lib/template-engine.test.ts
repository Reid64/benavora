import { describe, it, expect, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/ai/claude", () => ({ callClaude: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: vi.fn() })),
}));

import { EmailTemplateEngine } from "@/lib/email/template-engine";

const engine = new EmailTemplateEngine();

describe("EmailTemplateEngine.renderTemplate", () => {
  it("replaces all variables in subject and body", () => {
    const result = engine.renderTemplate(
      { subject: "Hello {contact_name}", body: "From {org_name} to {funder_name}" },
      { contact_name: "Alice", org_name: "Benavora", funder_name: "Gates Foundation" },
    );
    expect(result.subject).toBe("Hello Alice");
    expect(result.body).toBe("From Benavora to Gates Foundation");
  });

  it("throws on missing required variable", () => {
    expect(() =>
      engine.renderTemplate(
        { subject: "{contact_name}", body: "{funder_name}" },
        { contact_name: "Alice" },
      ),
    ).toThrow("Missing required template variable: {funder_name}");
  });

  it("replaces the same variable used multiple times", () => {
    const result = engine.renderTemplate(
      { subject: "{org_name}", body: "{org_name} — {org_name}" },
      { org_name: "Benavora" },
    );
    expect(result.body).toBe("Benavora — Benavora");
  });
});

describe("EmailTemplateEngine.validateTemplate", () => {
  it("identifies all variable placeholders", () => {
    const result = engine.validateTemplate(
      "{org_name} is applying to {funder_name} for {amount}.",
    );
    expect(result.variables).toContain("org_name");
    expect(result.variables).toContain("funder_name");
    expect(result.variables).toContain("amount");
    expect(result.variables).toHaveLength(3);
  });

  it("warns on unrecognized variables", () => {
    const result = engine.validateTemplate("Hello {random_field}");
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Unrecognized variable: {random_field}");
  });

  it("accepts custom_ prefixed variables without error", () => {
    const result = engine.validateTemplate("Hello {custom_nonprofit_id}");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("returns valid=true when all variables are standard", () => {
    const result = engine.validateTemplate("{org_name} — {contact_name} — {funder_name}");
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("deduplicates repeated variable placeholders", () => {
    const result = engine.validateTemplate("{org_name} {org_name} {org_name}");
    expect(result.variables).toHaveLength(1);
    expect(result.variables[0]).toBe("org_name");
  });
});
