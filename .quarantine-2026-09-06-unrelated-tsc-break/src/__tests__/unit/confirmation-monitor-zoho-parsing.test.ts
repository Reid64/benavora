// Email parsing/matching for the Zoho path of
// src/lib/autoapply/confirmation-monitor.ts. The Zoho path reuses the exact
// same stripHtml/emailDomainFromHeader/findMatches pure functions the Gmail
// path already used — these tests exercise them directly against
// Zoho-shaped input (an HTML `content` string from
// GET .../messages/{id}/content, and a `fromAddress` string from
// GET .../messages/view) to confirm that reuse actually works end to end,
// not just that the Gmail-shaped inputs it was written for still pass.
import { describe, it, expect } from "vitest";
import { stripHtml, emailDomainFromHeader, findMatches } from "@/lib/autoapply/confirmation-monitor";

describe("stripHtml on a Zoho message-content HTML body", () => {
  it("strips markup/styles/scripts and collapses whitespace into readable text", () => {
    const zohoContent =
      '<meta content="text/html;charset=UTF-8" />' +
      "<style>.x{color:red}</style>" +
      "<div>Dear Applicant,<br/>Your grant application to " +
      "<b>Example Family Foundation</b> was received.</div>" +
      "<script>trackOpen();</script>" +
      "<p>Confirmation&nbsp;#: EFF-2026-0042</p>";

    const text = stripHtml(zohoContent);

    expect(text).toContain("Dear Applicant, Your grant application to Example Family Foundation was received.");
    expect(text).toContain("Confirmation #: EFF-2026-0042");
    expect(text).not.toMatch(/<[^>]+>/);
    expect(text).not.toContain("trackOpen");
  });
});

describe("emailDomainFromHeader on Zoho's fromAddress field", () => {
  it("extracts the domain from a bare address (Zoho's typical fromAddress shape)", () => {
    expect(emailDomainFromHeader("grants@examplefoundation.org")).toBe("examplefoundation.org");
  });

  it("extracts the domain from a display-name-wrapped address", () => {
    expect(emailDomainFromHeader('"Example Foundation Grants" <grants@www.examplefoundation.org>')).toBe(
      "examplefoundation.org",
    );
  });

  it("returns null for a null fromAddress", () => {
    expect(emailDomainFromHeader(null)).toBeNull();
  });
});

describe("findMatches against a Zoho-sourced subject+body", () => {
  const candidates = [
    {
      submissionId: "sub-1",
      organizationId: "org-faith-foundation",
      funderId: "funder-1",
      portalUrl: "https://apply.examplefoundation.org",
      portalDomain: "examplefoundation.org",
      normalizedOrgName: "faith foundation",
    },
    {
      submissionId: "sub-2",
      organizationId: "org-other",
      funderId: "funder-2",
      portalUrl: "https://apply.otherfunder.org",
      portalDomain: "otherfunder.org",
      normalizedOrgName: "other org",
    },
  ];

  it("matches exactly one candidate when the domain and org name both agree", () => {
    const fromDomain = emailDomainFromHeader("grants@examplefoundation.org");
    const body =
      "Thank you Faith Foundation for your application. Confirmation #EFF-2026-0042.";
    const matches = findMatches(fromDomain, body, candidates);
    expect(matches).toEqual(["sub-1"]);
  });

  it("finds no match when the sender domain matches but the org name is absent from the email", () => {
    const fromDomain = emailDomainFromHeader("grants@examplefoundation.org");
    const body = "Thank you for your application. Confirmation #EFF-2026-0042.";
    const matches = findMatches(fromDomain, body, candidates);
    expect(matches).toEqual([]);
  });

  it("finds no match when the sender domain doesn't match any candidate's portal domain", () => {
    const fromDomain = emailDomainFromHeader("noreply@unrelated-sender.com");
    const body = "Thank you Faith Foundation for your application.";
    const matches = findMatches(fromDomain, body, candidates);
    expect(matches).toEqual([]);
  });
});
