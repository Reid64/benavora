import { describe, it, expect, vi, afterEach } from "vitest";

import * as grantsGovClient from "@/lib/sources/grantsgov-client";
import {
  searchEnvironmentalClimateGrants,
  ENVIRONMENTAL_CLIMATE_AGENCY_CODES,
  ENVIRONMENTAL_CLIMATE_FUNDING_CATEGORIES,
} from "./environmental-climate-grants";
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

describe("searchEnvironmentalClimateGrants — environment/climate agency+category filtering", () => {
  it("calls the shared client with all environmental/climate agency codes and funding categories for every default term", async () => {
    const spy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchEnvironmentalClimateGrants();

    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      expect(call[1]).toEqual({
        agencies: [...ENVIRONMENTAL_CLIMATE_AGENCY_CODES],
        fundingCategories: [...ENVIRONMENTAL_CLIMATE_FUNDING_CATEGORIES],
      });
    }
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["environment", "climate"]);
  });

  it("never includes HHS-NIH11 — excluded as a health-research vertical, not core environment/climate", () => {
    expect(ENVIRONMENTAL_CLIMATE_AGENCY_CODES).not.toContain("HHS-NIH11");
  });

  it("passes through a caller-supplied list of search terms instead of the default", async () => {
    const spy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchEnvironmentalClimateGrants(["renewable energy"]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("renewable energy");
  });

  it("deduplicates opportunities that appear under more than one search term", async () => {
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("2", "Only In Environment")])
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("3", "Only In Climate")]);

    const result = await searchEnvironmentalClimateGrants();

    expect(result.map((o) => o.externalId).sort()).toEqual(["1", "2", "3"]);
  });

  it("returns [] when the client returns no hits for any term", async () => {
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities").mockResolvedValue([]);
    const result = await searchEnvironmentalClimateGrants();
    expect(result).toEqual([]);
  });
});
