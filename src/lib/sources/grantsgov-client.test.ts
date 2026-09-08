import { describe, it, expect, vi, afterEach } from "vitest";

import {
  searchGrantsGovOpportunities,
  discoverAgencySubCodes,
  getAgencyCodesWithFallback,
  AGENCY_CODE_CACHE_TTL_MS,
  __resetAgencyCodeCacheForTests,
} from "./grantsgov-client";

function jsonResponse(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
  } as Response;
}

const SAMPLE_HIT = {
  id: "355824",
  title: "Sample &amp; Grant",
  closeDate: "10/14/2026",
};

afterEach(() => {
  vi.restoreAllMocks();
  __resetAgencyCodeCacheForTests();
});

describe("searchGrantsGovOpportunities — request shape", () => {
  it("sends no agencies/fundingCategories fields when called without options (existing-caller shape)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: { oppHits: [SAMPLE_HIT] } }));

    await searchGrantsGovOpportunities("housing");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      keyword: "housing",
      oppStatuses: "posted",
      rows: 100,
      startRecordNum: 0,
    });
    expect(body.agencies).toBeUndefined();
    expect(body.fundingCategories).toBeUndefined();
  });

  it("adds a pipe-delimited agencies field when options.agencies is passed", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: { oppHits: [] } }));

    await searchGrantsGovOpportunities("education", { agencies: ["ED"] });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.agencies).toBe("ED");
  });

  it("joins multiple agency codes with a pipe", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: { oppHits: [] } }));

    await searchGrantsGovOpportunities("education", { agencies: ["ED", "DOL"] });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.agencies).toBe("ED|DOL");
  });

  it("adds a pipe-delimited fundingCategories field when options.fundingCategories is passed", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: { oppHits: [] } }));

    await searchGrantsGovOpportunities("workforce", { fundingCategories: ["ED", "ELT"] });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.fundingCategories).toBe("ED|ELT");
  });

  it("omits agencies/fundingCategories fields when passed as empty arrays", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: { oppHits: [] } }));

    await searchGrantsGovOpportunities("education", { agencies: [], fundingCategories: [] });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body.agencies).toBeUndefined();
    expect(body.fundingCategories).toBeUndefined();
  });
});

describe("searchGrantsGovOpportunities — existing behavior unchanged", () => {
  it("returns [] for a blank/whitespace search term without calling fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await searchGrantsGovOpportunities("   ");
    expect(result).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps a hit and decodes HTML entities in the title", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: { oppHits: [SAMPLE_HIT] } }),
    );

    const result = await searchGrantsGovOpportunities("housing");

    expect(result).toEqual([
      {
        externalId: "355824",
        name: "Sample & Grant",
        description: null,
        amount: null,
        deadline: "2026-10-14",
        category: "Government Federal",
        source: "grants_gov",
      },
    ]);
  });

  it("returns [] on a non-ok HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));
    const result = await searchGrantsGovOpportunities("housing");
    expect(result).toEqual([]);
  });

  it("returns [] when the response body fails to parse as JSON", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error("bad json");
      },
    } as unknown as Response);
    const result = await searchGrantsGovOpportunities("housing");
    expect(result).toEqual([]);
  });

  it("returns [] when fetch throws (network error)", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const result = await searchGrantsGovOpportunities("housing");
    expect(result).toEqual([]);
  });

  it("skips hits missing an id or title", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({
        data: {
          oppHits: [{ id: "", title: "No id" }, { id: "123", title: "" }, SAMPLE_HIT],
        },
      }),
    );
    const result = await searchGrantsGovOpportunities("housing");
    expect(result).toHaveLength(1);
    expect(result[0]?.externalId).toBe("355824");
  });
});

const HHS_FACET = {
  label: "Department of Health and Human Services",
  value: "HHS",
  count: 251,
  subAgencyOptions: [
    { label: "National Institutes of Health", value: "HHS-NIH11", count: 213 },
    { label: "Centers for Disease Control-GHC", value: "HHS-CDC-GHC", count: 11 },
  ],
};

const ED_FACET_NO_SUBAGENCIES = {
  label: "Department of Education",
  value: "ED",
  count: 2,
  subAgencyOptions: [],
};

describe("discoverAgencySubCodes — live agency facet discovery", () => {
  it("sends an unfiltered, empty-keyword request so the facet covers every current agency", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: { agencies: [HHS_FACET] } }));

    await discoverAgencySubCodes("HHS");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({
      keyword: "",
      oppStatuses: "posted|forecasted",
      rows: 1,
      startRecordNum: 0,
    });
    expect(body.agencies).toBeUndefined();
  });

  it("returns the parent's sub-agency codes when it has any", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: { agencies: [HHS_FACET] } }),
    );

    const codes = await discoverAgencySubCodes("HHS");

    expect(codes).toEqual(["HHS-NIH11", "HHS-CDC-GHC"]);
  });

  it("returns the parent code itself when the facet entry has no sub-agencies", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: { agencies: [ED_FACET_NO_SUBAGENCIES] } }),
    );

    const codes = await discoverAgencySubCodes("ED");

    expect(codes).toEqual(["ED"]);
  });

  it("returns [] when the parent has no facet entry at all (zero current postings)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { agencies: [] } }));

    const codes = await discoverAgencySubCodes("HHS");

    expect(codes).toEqual([]);
  });

  it("returns [] on a non-ok HTTP response", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({}, { ok: false, status: 500 }));
    expect(await discoverAgencySubCodes("HHS")).toEqual([]);
  });

  it("returns [] when fetch throws", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    expect(await discoverAgencySubCodes("HHS")).toEqual([]);
  });
});

describe("getAgencyCodesWithFallback — cached discovery with dated-snapshot fallback", () => {
  it("returns live-discovered codes, not the fallback, when discovery succeeds", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      jsonResponse({ data: { agencies: [HHS_FACET] } }),
    );

    const codes = await getAgencyCodesWithFallback("HHS", ["HHS-STALE-FALLBACK"]);

    expect(codes).toEqual(["HHS-NIH11", "HHS-CDC-GHC"]);
  });

  it("falls back to the caller-supplied snapshot when discovery returns nothing", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(jsonResponse({ data: { agencies: [] } }));

    const codes = await getAgencyCodesWithFallback("HHS", ["HHS-STALE-FALLBACK"]);

    expect(codes).toEqual(["HHS-STALE-FALLBACK"]);
  });

  it("serves subsequent calls from cache within the TTL without hitting the network again", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: { agencies: [HHS_FACET] } }));

    const first = await getAgencyCodesWithFallback("HHS", ["HHS-STALE-FALLBACK"]);
    const second = await getAgencyCodesWithFallback("HHS", ["HHS-STALE-FALLBACK"]);

    expect(first).toEqual(second);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("re-discovers after the cache TTL has elapsed", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    let now = 1_000_000;
    nowSpy.mockImplementation(() => now);

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ data: { agencies: [HHS_FACET] } }));

    await getAgencyCodesWithFallback("HHS", ["HHS-STALE-FALLBACK"]);
    now += AGENCY_CODE_CACHE_TTL_MS + 1;
    await getAgencyCodesWithFallback("HHS", ["HHS-STALE-FALLBACK"]);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});
