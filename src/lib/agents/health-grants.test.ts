import { describe, it, expect, vi, afterEach } from "vitest";

import * as grantsGovClient from "@/lib/sources/grantsgov-client";
import {
  searchHealthGrants,
  HHS_FAMILY_AGENCY_CODES,
  HEALTH_FUNDING_CATEGORIES,
} from "./health-grants";
import type { GrantsGovNormalizedOpportunity } from "@/lib/sources/grantsgov-client";

function opp(externalId: string, name: string): GrantsGovNormalizedOpportunity {
  return {
    externalId,
    name,
    description: null,
    amount: null,
    deadline: null,
    category: "Government Federal",
    source: "grants_gov",
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchHealthGrants — HHS-family/health category filtering", () => {
  it("calls the shared client with all HHS-family sub-agency codes and the Health funding category for every default term", async () => {
    const spy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchHealthGrants();

    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      expect(call[1]).toEqual({
        agencies: [...HHS_FAMILY_AGENCY_CODES],
        fundingCategories: [...HEALTH_FUNDING_CATEGORIES],
      });
    }
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["health", "public health"]);
  });

  it("never includes the bare parent 'HHS' code — only real sub-agency codes (verified live to 0-match on its own)", () => {
    expect(HHS_FAMILY_AGENCY_CODES).not.toContain("HHS");
    for (const code of HHS_FAMILY_AGENCY_CODES) {
      expect(code.startsWith("HHS-")).toBe(true);
    }
  });

  it("passes through a caller-supplied list of search terms instead of the default", async () => {
    const spy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchHealthGrants(["maternal health"]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("maternal health");
  });

  it("deduplicates opportunities that appear under more than one search term", async () => {
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("2", "Only In Health")])
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("3", "Only In Public Health")]);

    const result = await searchHealthGrants();

    expect(result.map((o) => o.externalId).sort()).toEqual(["1", "2", "3"]);
  });

  it("returns [] when the client returns no hits for any term", async () => {
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities").mockResolvedValue([]);
    const result = await searchHealthGrants();
    expect(result).toEqual([]);
  });
});
