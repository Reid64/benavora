import { describe, it, expect, vi, afterEach } from "vitest";

import * as grantsGovClient from "@/lib/sources/grantsgov-client";
import { __resetAgencyCodeCacheForTests } from "@/lib/sources/grantsgov-client";
import {
  searchHealthGrants,
  HHS_PARENT_AGENCY_CODE,
  HHS_FAMILY_AGENCY_CODES_FALLBACK,
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

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
  __resetAgencyCodeCacheForTests();
});

describe("searchHealthGrants — HHS-family/health category filtering", () => {
  it("discovers agency codes for the HHS parent (with the dated snapshot as fallback) and applies them plus the Health funding category to every default term", async () => {
    const discoverSpy = vi
      .spyOn(grantsGovClient, "getAgencyCodesWithFallback")
      .mockResolvedValue([...HHS_FAMILY_AGENCY_CODES_FALLBACK]);
    const searchSpy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchHealthGrants();

    expect(discoverSpy).toHaveBeenCalledWith(HHS_PARENT_AGENCY_CODE, HHS_FAMILY_AGENCY_CODES_FALLBACK);
    expect(searchSpy).toHaveBeenCalledTimes(2);
    for (const call of searchSpy.mock.calls) {
      expect(call[1]).toEqual({
        agencies: [...HHS_FAMILY_AGENCY_CODES_FALLBACK],
        fundingCategories: [...HEALTH_FUNDING_CATEGORIES],
      });
    }
    expect(searchSpy.mock.calls.map((c) => c[0])).toEqual(["health", "public health"]);
  });

  it("never includes the bare parent 'HHS' code in the fallback snapshot — only real sub-agency codes (verified live to 0-match on its own)", () => {
    expect(HHS_FAMILY_AGENCY_CODES_FALLBACK).not.toContain("HHS");
    for (const code of HHS_FAMILY_AGENCY_CODES_FALLBACK) {
      expect(code.startsWith("HHS-")).toBe(true);
    }
  });

  it("passes through a caller-supplied list of search terms instead of the default", async () => {
    vi.spyOn(grantsGovClient, "getAgencyCodesWithFallback").mockResolvedValue([
      ...HHS_FAMILY_AGENCY_CODES_FALLBACK,
    ]);
    const searchSpy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchHealthGrants(["maternal health"]);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy.mock.calls[0]?.[0]).toBe("maternal health");
  });

  it("deduplicates opportunities that appear under more than one search term", async () => {
    vi.spyOn(grantsGovClient, "getAgencyCodesWithFallback").mockResolvedValue([
      ...HHS_FAMILY_AGENCY_CODES_FALLBACK,
    ]);
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("2", "Only In Health")])
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("3", "Only In Public Health")]);

    const result = await searchHealthGrants();

    expect(result.map((o) => o.externalId).sort()).toEqual(["1", "2", "3"]);
  });

  it("returns [] when the client returns no hits for any term", async () => {
    vi.spyOn(grantsGovClient, "getAgencyCodesWithFallback").mockResolvedValue([
      ...HHS_FAMILY_AGENCY_CODES_FALLBACK,
    ]);
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities").mockResolvedValue([]);
    const result = await searchHealthGrants();
    expect(result).toEqual([]);
  });

  it("falls back to the dated snapshot when live agency discovery is unavailable", async () => {
    // No mock on getAgencyCodesWithFallback itself — drive it for real, but
    // fake the network boundary so live discovery returns nothing (as it
    // does on an API outage, or when HHS transiently has zero live
    // postings).
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { agencies: [] } }));
    const searchSpy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchHealthGrants(["maternal health"]);

    expect(searchSpy).toHaveBeenCalledWith("maternal health", {
      agencies: [...HHS_FAMILY_AGENCY_CODES_FALLBACK],
      fundingCategories: [...HEALTH_FUNDING_CATEGORIES],
    });
  });

  it("picks up an HHS sub-agency code that Grants.gov added/renamed after this code was last deployed, with no code change needed", async () => {
    // This is the real end-to-end path: only `fetch` (the network boundary)
    // is mocked, not our own discovery/search functions. The first call is
    // the live agency-facet discovery request; it returns a sub-agency code
    // that exists nowhere in this codebase's hardcoded fallback list,
    // simulating Grants.gov renaming/adding an HHS operating division after
    // this file was last deployed. The second call is the actual opportunity
    // search — asserting its request body carries the *new* code (and none
    // of the old fallback codes) proves the agent adapts at runtime.
    const NEW_CODE = "HHS-NEWDIV-2027";
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => {
      call += 1;
      if (call === 1) {
        // discoverAgencySubCodes: unfiltered facet lookup
        return jsonResponse({
          data: {
            agencies: [
              {
                label: "Department of Health and Human Services",
                value: "HHS",
                count: 1,
                subAgencyOptions: [{ label: "New Operating Division", value: NEW_CODE, count: 1 }],
              },
            ],
          },
        });
      }
      // searchGrantsGovOpportunities: the actual filtered search call
      return jsonResponse({ data: { oppHits: [] } });
    }) as typeof fetch);

    await searchHealthGrants(["health"]);

    expect(call).toBe(2);
    const [, secondInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      RequestInit,
    ];
    const secondBody = JSON.parse(secondInit.body as string);
    expect(secondBody.agencies).toBe(NEW_CODE);
    for (const staleCode of HHS_FAMILY_AGENCY_CODES_FALLBACK) {
      expect(secondBody.agencies).not.toContain(staleCode);
    }
  });
});
