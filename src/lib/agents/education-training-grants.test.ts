import { describe, it, expect, vi, afterEach } from "vitest";

import * as grantsGovClient from "@/lib/sources/grantsgov-client";
import { __resetAgencyCodeCacheForTests } from "@/lib/sources/grantsgov-client";
import {
  searchEducationTrainingGrants,
  EDUCATION_PARENT_AGENCY_CODE,
  EDUCATION_AGENCY_CODES_FALLBACK,
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

describe("searchEducationTrainingGrants — category/agency filtering", () => {
  it("discovers agency codes for the ED parent (with the dated snapshot as fallback) and applies them plus education/workforce funding categories for every default term", async () => {
    const discoverSpy = vi
      .spyOn(grantsGovClient, "getAgencyCodesWithFallback")
      .mockResolvedValue([...EDUCATION_AGENCY_CODES_FALLBACK]);
    const searchSpy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchEducationTrainingGrants();

    expect(discoverSpy).toHaveBeenCalledWith(
      EDUCATION_PARENT_AGENCY_CODE,
      EDUCATION_AGENCY_CODES_FALLBACK,
    );
    expect(searchSpy).toHaveBeenCalledTimes(2);
    for (const call of searchSpy.mock.calls) {
      expect(call[1]).toEqual({
        agencies: [...EDUCATION_AGENCY_CODES_FALLBACK],
        fundingCategories: [...EDUCATION_TRAINING_FUNDING_CATEGORIES],
      });
    }
    expect(searchSpy.mock.calls.map((c) => c[0])).toEqual(["education", "workforce training"]);
  });

  it("passes through a caller-supplied list of search terms instead of the default", async () => {
    vi.spyOn(grantsGovClient, "getAgencyCodesWithFallback").mockResolvedValue([
      ...EDUCATION_AGENCY_CODES_FALLBACK,
    ]);
    const searchSpy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchEducationTrainingGrants(["STEM education"]);

    expect(searchSpy).toHaveBeenCalledTimes(1);
    expect(searchSpy.mock.calls[0]?.[0]).toBe("STEM education");
  });

  it("deduplicates opportunities that appear under more than one search term", async () => {
    vi.spyOn(grantsGovClient, "getAgencyCodesWithFallback").mockResolvedValue([
      ...EDUCATION_AGENCY_CODES_FALLBACK,
    ]);
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("2", "Only In Education")])
      .mockResolvedValueOnce([opp("1", "Shared Grant"), opp("3", "Only In Workforce")]);

    const result = await searchEducationTrainingGrants();

    expect(result.map((o) => o.externalId).sort()).toEqual(["1", "2", "3"]);
  });

  it("returns [] when the client returns no hits for any term", async () => {
    vi.spyOn(grantsGovClient, "getAgencyCodesWithFallback").mockResolvedValue([
      ...EDUCATION_AGENCY_CODES_FALLBACK,
    ]);
    vi.spyOn(grantsGovClient, "searchGrantsGovOpportunities").mockResolvedValue([]);
    const result = await searchEducationTrainingGrants();
    expect(result).toEqual([]);
  });

  it("falls back to the dated snapshot when live agency discovery is unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { agencies: [] } }));
    const searchSpy = vi
      .spyOn(grantsGovClient, "searchGrantsGovOpportunities")
      .mockResolvedValue([]);

    await searchEducationTrainingGrants(["STEM education"]);

    expect(searchSpy).toHaveBeenCalledWith("STEM education", {
      agencies: [...EDUCATION_AGENCY_CODES_FALLBACK],
      fundingCategories: [...EDUCATION_TRAINING_FUNDING_CATEGORIES],
    });
  });

  it("picks up an ED sub-agency split that Grants.gov introduces after this code was last deployed, with no code change needed", async () => {
    // Real end-to-end path: only `fetch` is mocked. The first call is the
    // live agency-facet discovery request, returning a sub-agency code that
    // exists nowhere in this codebase, simulating Grants.gov subdividing
    // the Department of Education after this file was last deployed. The
    // second call is the actual opportunity search — its request body must
    // carry the new code, proving the agent adapts at runtime.
    const NEW_CODE = "ED-NEWDIV-2027";
    let call = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((async () => {
      call += 1;
      if (call === 1) {
        return jsonResponse({
          data: {
            agencies: [
              {
                label: "Department of Education",
                value: "ED",
                count: 1,
                subAgencyOptions: [{ label: "New Division", value: NEW_CODE, count: 1 }],
              },
            ],
          },
        });
      }
      return jsonResponse({ data: { oppHits: [] } });
    }) as typeof fetch);

    await searchEducationTrainingGrants(["education"]);

    expect(call).toBe(2);
    const [, secondInit] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[1] as [
      string,
      RequestInit,
    ];
    const secondBody = JSON.parse(secondInit.body as string);
    expect(secondBody.agencies).toBe(NEW_CODE);
  });
});
