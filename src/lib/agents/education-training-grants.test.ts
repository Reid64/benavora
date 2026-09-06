import { describe, it, expect, vi, afterEach } from "vitest";

import * as grantsGovClient from "@/lib/sources/grantsgov-client";
import {
  searchEducationTrainingGrants,
  EDUCATION_AGENCY_CODES,
  EDUCATION_TRAINING_FUNDING_CATEGORIES,
} from "./education-training-grants";
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

describe("searchEducationTrainingGrants — category/agency filtering", () => {
  it("calls the shared client with the DOE agency code and education/workforce funding categories for every default term", async () => {
    const spy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchEducationTrainingGrants();

    expect(spy).toHaveBeenCalledTimes(2);
    for (const call of spy.mock.calls) {
      expect(call[1]).toEqual({
        agencies: [...EDUCATION_AGENCY_CODES],
        fundingCategories: [...EDUCATION_TRAINING_FUNDING_CATEGORIES],
      });
    }
    expect(spy.mock.calls.map((c) => c[0])).toEqual(["education", "workforce training"]);
  });

  it("passes through a caller-supplied list of search terms instead of the default", async () => {
    const spy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchEducationTrainingGrants(["STEM education"]);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toBe("STEM education");
  });

  it("deduplicates opportunities that appear under more than one search term", async () => {
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("2", "Only In Education")])
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("3", "Only In Workforce")]);

    const result = await searchEducationTrainingGrants();

    expect(result.map((o) => o.externalId).sort()).toEqual(["1", "2", "3"]);
  });

  it("returns [] when the client returns no hits for any term", async () => {
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities").mockResolvedValue([]);
    const result = await searchEducationTrainingGrants();
    expect(result).toEqual([]);
  });
});
