import { describe, it, expect, vi, afterEach } from "vitest";
import {
  fetchProPublicaFinancials,
  enrichFoundationFromProPublica,
} from "@/lib/sources/propublica-990-client";

function jsonResponse(body: unknown, ok = true) {
  return {
    ok,
    json: () => Promise.resolve(body),
  } as Response;
}

describe("fetchProPublicaFinancials", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null on HTTP error (non-ok response)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false)));

    const result = await fetchProPublicaFinancials("123456789");

    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await fetchProPublicaFinancials("123456789");

    expect(result).toBeNull();
  });

  it("returns null on JSON parse failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error("bad json")),
      }),
    );

    const result = await fetchProPublicaFinancials("123456789");

    expect(result).toBeNull();
  });

  it("returns null when the EIN has no digits", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchProPublicaFinancials("--");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("strips non-digit characters from the EIN before requesting", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ filings_with_data: [{ totrevenue: 1000, totassetsend: 2000 }] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await fetchProPublicaFinancials("12-3456789");

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/organizations/123456789.json"),
      expect.any(Object),
    );
  });

  it("extracts totrevenue and totassetsend from the most recent filing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          organization: { ein: 123456789 },
          filings_with_data: [
            { totrevenue: 500000, totassetsend: 750000 },
            { totrevenue: 400000, totassetsend: 600000 },
          ],
        }),
      ),
    );

    const result = await fetchProPublicaFinancials("123456789");

    expect(result).toEqual({
      ein: "123456789",
      totalRevenue: 500000,
      totalAssets: 750000,
    });
  });

  it("returns null financial fields when there are no filings", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ filings_with_data: [] })));

    const result = await fetchProPublicaFinancials("123456789");

    expect(result).toEqual({ ein: "123456789", totalRevenue: null, totalAssets: null });
  });

  it("returns null for non-numeric filing values instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          filings_with_data: [{ totrevenue: "N/A", totassetsend: null }],
        }),
      ),
    );

    const result = await fetchProPublicaFinancials("123456789");

    expect(result).toEqual({ ein: "123456789", totalRevenue: null, totalAssets: null });
  });
});

describe("enrichFoundationFromProPublica", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null on HTTP error (non-ok response)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, false)));

    const result = await enrichFoundationFromProPublica("123456789");

    expect(result).toBeNull();
  });

  it("returns null on network error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const result = await enrichFoundationFromProPublica("123456789");

    expect(result).toBeNull();
  });

  it("returns null on JSON parse failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.reject(new Error("bad json")),
      }),
    );

    const result = await enrichFoundationFromProPublica("123456789");

    expect(result).toBeNull();
  });

  it("returns null when the EIN has no digits", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await enrichFoundationFromProPublica("abc");

    expect(result).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("extracts identity fields and the latest filing's financials", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          organization: {
            name: "Faith Foundation",
            ntee_code: "P30",
            state: "TX",
            city: "Waco",
            subsection_code: "03",
          },
          filings_with_data: [
            { totrevenue: 100000, totassetsend: 250000, totfuncexpns: 90000, fiscal_period: 12 },
          ],
        }),
      ),
    );

    const result = await enrichFoundationFromProPublica("12-3456789");

    expect(result).toEqual({
      ein: "123456789",
      name: "Faith Foundation",
      ntee_code: "P30",
      state: "TX",
      city: "Waco",
      subsection_code: "03",
      totrevenue: 100000,
      totassetsend: 250000,
      totfuncexpns: 90000,
      fiscal_period: 12,
    });
  });

  it("falls back to tax_prd_yr when the filing has no fiscal_period", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          organization: {},
          filings_with_data: [{ totrevenue: 1, totassetsend: 2, tax_prd_yr: 2025 }],
        }),
      ),
    );

    const result = await enrichFoundationFromProPublica("123456789");

    expect(result?.fiscal_period).toBe(2025);
  });

  it("returns all-null identity and financial fields when organization and filings are absent", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({})));

    const result = await enrichFoundationFromProPublica("123456789");

    expect(result).toEqual({
      ein: "123456789",
      name: null,
      ntee_code: null,
      state: null,
      city: null,
      subsection_code: null,
      totrevenue: null,
      totassetsend: null,
      totfuncexpns: null,
      fiscal_period: null,
    });
  });

  it("coerces non-finite filing financial values to null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          organization: {},
          filings_with_data: [{ totrevenue: NaN, totassetsend: "500000", totfuncexpns: Infinity }],
        }),
      ),
    );

    const result = await enrichFoundationFromProPublica("123456789");

    expect(result?.totrevenue).toBeNull();
    expect(result?.totassetsend).toBeNull();
    expect(result?.totfuncexpns).toBeNull();
  });
});
