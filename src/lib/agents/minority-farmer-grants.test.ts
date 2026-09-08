import { describe, it, expect, vi, afterEach } from "vitest";

import * as grantsGovClient from "@/lib/sources/grantsgov-client";
import {
  searchMinorityFarmerGrants,
  MINORITY_FARMER_AGENCY_CODES,
} from "./minority-farmer-grants";
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

describe("searchMinorityFarmerGrants — USDA-NIFA 2501-program agency+keyword filtering", () => {
  it("calls the shared client with the USDA-NIFA agency code for every default term", async () => {
    const spy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchMinorityFarmerGrants();

    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      expect(call[1]).toEqual({
        agencies: [...MINORITY_FARMER_AGENCY_CODES],
      });
    }
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["socially disadvantaged", "2501"]);
  });

  it("scopes to USDA-NIFA only — the real administrator of the 2501 program family", () => {
    expect(MINORITY_FARMER_AGENCY_CODES).toEqual(["USDA-NIFA"]);
  });

  it("passes through a caller-supplied list of search terms instead of the default", async () => {
    const spy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchMinorityFarmerGrants(["veteran farmers and ranchers"]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("veteran farmers and ranchers");
  });

  it("deduplicates opportunities that appear under more than one search term", async () => {
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("2", "Only In First Term")])
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("3", "Only In Second Term")]);

    const result = await searchMinorityFarmerGrants();

    expect(result.map((o) => o.externalId).sort()).toEqual(["1", "2", "3"]);
  });

  it("returns [] when the client returns no hits for any term", async () => {
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities").mockResolvedValue([]);
    const result = await searchMinorityFarmerGrants();
    expect(result).toEqual([]);
  });
});
