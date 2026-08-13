import { describe, it, expect, vi, afterEach } from "vitest";
import { searchSamGovOpportunities } from "@/lib/sources/samgov-client";

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("searchSamGovOpportunities", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("returns an empty array when SAM_GOV_API_KEY is unset", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await searchSamGovOpportunities();

    expect(result).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns an empty array on network error", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await searchSamGovOpportunities();

    expect(result).toEqual([]);
  });

  it("returns an empty array on HTTP error (non-ok response)", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false)));

    const result = await searchSamGovOpportunities();

    expect(result).toEqual([]);
  });

  it("returns an empty array on JSON parse failure", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error("bad json")),
      }),
    );

    const result = await searchSamGovOpportunities();

    expect(result).toEqual([]);
  });

  it("returns an empty array when opportunitiesData is missing", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));

    const result = await searchSamGovOpportunities();

    expect(result).toEqual([]);
  });

  it("includes the API key, ptype=o, and limit in the request URL", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "secret-key-123");
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ opportunitiesData: [] }));
    vi.stubGlobal("fetch", fetchMock);

    await searchSamGovOpportunities();

    const calledUrl = fetchMock.mock.calls[0]![0] as string;
    expect(calledUrl).toContain("https://api.sam.gov/opportunities/v2/search?");
    expect(calledUrl).toContain("api_key=secret-key-123");
    expect(calledUrl).toContain("ptype=o");
    expect(calledUrl).toContain("limit=100");
  });

  it("maps a valid hit to the normalized opportunity shape, decoding HTML entities in the title", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          opportunitiesData: [
            {
              noticeId: "NOTICE-1",
              title: "Housing &amp; Urban Development Grant",
              description: "Rural transitional housing support",
              responseDeadLine: "2026-09-01T23:59:00-05:00",
              awardAmount: "500000",
            },
          ],
        }),
      ),
    );

    const result = await searchSamGovOpportunities();

    expect(result).toEqual([
      {
        externalId: "NOTICE-1",
        name: "Housing & Urban Development Grant",
        description: "Rural transitional housing support",
        amount: 500000,
        deadline: "2026-09-01",
        category: "Government Federal",
        source: "sam_gov",
      },
    ]);
  });

  it("drops hits missing a noticeId or title", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          opportunitiesData: [
            { noticeId: "", title: "Missing Notice ID" },
            { noticeId: "NOTICE-2", title: "" },
            { noticeId: "NOTICE-3", title: "Valid Opportunity" },
          ],
        }),
      ),
    );

    const result = await searchSamGovOpportunities();

    expect(result).toHaveLength(1);
    expect(result[0]!.externalId).toBe("NOTICE-3");
  });

  it("maps a zero or negative award amount to null", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          opportunitiesData: [
            { noticeId: "NOTICE-1", title: "Zero Amount", awardAmount: 0 },
            { noticeId: "NOTICE-2", title: "Negative Amount", awardAmount: -100 },
          ],
        }),
      ),
    );

    const result = await searchSamGovOpportunities();

    expect(result[0]!.amount).toBeNull();
    expect(result[1]!.amount).toBeNull();
  });

  it("returns a null deadline when responseDeadLine is absent or unparseable", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          opportunitiesData: [
            { noticeId: "NOTICE-1", title: "No Deadline" },
            { noticeId: "NOTICE-2", title: "Bad Deadline", responseDeadLine: "not-a-date" },
          ],
        }),
      ),
    );

    const result = await searchSamGovOpportunities();

    expect(result[0]!.deadline).toBeNull();
    expect(result[1]!.deadline).toBeNull();
  });

  it("parses a full ISO datetime without a leading date match via the Date fallback", async () => {
    vi.stubEnv("SAM_GOV_API_KEY", "test-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          opportunitiesData: [
            {
              noticeId: "NOTICE-1",
              title: "Fallback Parse",
              responseDeadLine: "September 1, 2026",
            },
          ],
        }),
      ),
    );

    const result = await searchSamGovOpportunities();

    expect(result[0]!.deadline).toBe("2026-09-01");
  });
});
