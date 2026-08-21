// WGR-158/WGR-159: worker/dd-request-processor.ts's isBmfGeography() is the
// single dispatch rule deciding which enumeration adapter (Google Places /
// NAICS, or BMF-foundation_directory / NTEE) a request routes to. This
// tests that rule directly against every geography shape the API route
// accepts, so a future edit to one side (the dispatcher) can't silently
// drift from the other (the API's own requiredTaxonomyKind()).
import { describe, it, expect } from "vitest";
import { isBmfGeography } from "../../../worker/dd-request-processor";

describe("dd-request-processor: isBmfGeography (dispatcher routing)", () => {
  it("routes states geography to BMF", () => {
    expect(isBmfGeography({ states: ["TX"] })).toBe(true);
  });

  it("routes national geography to BMF", () => {
    expect(isBmfGeography({ national: true })).toBe(true);
  });

  it("routes states geography with BMF extras (min_assets/limit) to BMF", () => {
    expect(isBmfGeography({ states: ["TX", "OK"], min_assets: 1_000_000, limit: 200 } as never)).toBe(true);
  });

  it("does NOT route radius geography to BMF (stays on Places)", () => {
    expect(isBmfGeography({ center: { lat: 29.76, lng: -95.37 }, radius_mi: 30 })).toBe(false);
  });
});
