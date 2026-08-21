// WGR-156: scripts/seed-foundation-prospects.ts previously had no guard at
// all and dumped 133,812 rows into a real customer's pipeline. This tests
// the extracted, pure guard logic (scripts/lib/seed-org-guard.ts) that now
// blocks that: refuse a non-test-looking org unless --allow-real-org is
// passed, and cap rows processed at --limit (default 200).
import { describe, it, expect } from "vitest";
import {
  parseSeedArgs,
  looksLikeTestOrg,
  isAllowedToSeed,
  DEFAULT_SEED_LIMIT,
} from "../../../scripts/lib/seed-org-guard";

const REAL_ORG = { name: "Faith Foundation", email: "info@faithfoundationsf.org", contact_email: null };
const TEST_ORG_BY_NAME = { name: "benavora-test-org-1", email: null, contact_email: null };
const TEST_ORG_BY_EMAIL = { name: "Acme Inc", email: "owner@benavora-test.example", contact_email: null };
const TEST_ORG_BY_CONTACT_EMAIL = { name: "Acme Inc", email: null, contact_email: "x@Beta Org.example" };
const BETA_ORG_BY_NAME = { name: "Our Beta Org Account", email: null, contact_email: null };

describe("seed-org-guard: looksLikeTestOrg", () => {
  it("does not match a real customer org", () => {
    expect(looksLikeTestOrg(REAL_ORG)).toBe(false);
  });

  it("matches on name containing benavora-test", () => {
    expect(looksLikeTestOrg(TEST_ORG_BY_NAME)).toBe(true);
  });

  it("matches on email containing benavora-test", () => {
    expect(looksLikeTestOrg(TEST_ORG_BY_EMAIL)).toBe(true);
  });

  it("matches on contact_email containing Beta Org", () => {
    expect(looksLikeTestOrg(TEST_ORG_BY_CONTACT_EMAIL)).toBe(true);
  });

  it("matches on name containing Beta Org", () => {
    expect(looksLikeTestOrg(BETA_ORG_BY_NAME)).toBe(true);
  });

  it("handles null name/email/contact_email without throwing", () => {
    expect(looksLikeTestOrg({ name: null, email: null, contact_email: null })).toBe(false);
  });
});

describe("seed-org-guard: isAllowedToSeed", () => {
  it("refuses a real org with no override", () => {
    expect(isAllowedToSeed(REAL_ORG, false)).toBe(false);
  });

  it("allows a real org when --allow-real-org is set", () => {
    expect(isAllowedToSeed(REAL_ORG, true)).toBe(true);
  });

  it("allows a test-looking org even without the override", () => {
    expect(isAllowedToSeed(TEST_ORG_BY_NAME, false)).toBe(true);
  });
});

describe("seed-org-guard: parseSeedArgs", () => {
  const DEFAULT_ORG = "b1ab7402-dfc2-4712-869f-70ea3566cc1d";

  it("defaults to the given org id, no override, and DEFAULT_SEED_LIMIT", () => {
    const args = parseSeedArgs([], DEFAULT_ORG);
    expect(args).toEqual({ orgId: DEFAULT_ORG, allowRealOrg: false, limit: DEFAULT_SEED_LIMIT });
  });

  it("caps rows at --limit=200 by default (no flag needed)", () => {
    const args = parseSeedArgs([], DEFAULT_ORG);
    expect(args.limit).toBe(200);
  });

  it("parses --allow-real-org", () => {
    expect(parseSeedArgs(["--allow-real-org"], DEFAULT_ORG).allowRealOrg).toBe(true);
  });

  it("parses --org-id=<uuid>", () => {
    const args = parseSeedArgs(["--org-id=11111111-1111-1111-1111-111111111111"], DEFAULT_ORG);
    expect(args.orgId).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("parses --limit=<n>", () => {
    expect(parseSeedArgs(["--limit=50"], DEFAULT_ORG).limit).toBe(50);
  });

  it("throws on a non-numeric --limit", () => {
    expect(() => parseSeedArgs(["--limit=abc"], DEFAULT_ORG)).toThrow();
  });

  it("throws on a zero or negative --limit", () => {
    expect(() => parseSeedArgs(["--limit=0"], DEFAULT_ORG)).toThrow();
    expect(() => parseSeedArgs(["--limit=-5"], DEFAULT_ORG)).toThrow();
  });
});
