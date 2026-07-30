import { describe, it, expect } from "vitest";
import {
  NAICS_FRIENDLY_LABELS,
  NAICS_CATEGORIES,
  naicsLabel,
} from "@/lib/donor-discovery/naics-labels";

describe("naicsLabel", () => {
  it("returns the friendly label for a known code", () => {
    expect(naicsLabel("238910")).toBe("Site Preparation & Grading");
    expect(naicsLabel("524")).toBe("Insurance Companies");
  });

  it("returns the code unchanged for an unknown code", () => {
    expect(naicsLabel("999999")).toBe("999999");
  });
});

describe("NAICS_FRIENDLY_LABELS", () => {
  it("contains entries for the core consumer-facing sectors", () => {
    expect(NAICS_FRIENDLY_LABELS["524"]).toBe("Insurance Companies");
    expect(NAICS_FRIENDLY_LABELS["522"]).toBe("Banks & Credit Unions");
    expect(NAICS_FRIENDLY_LABELS["311"]).toBe("Food Manufacturers");
  });

  it("has no empty or blank labels", () => {
    for (const [code, label] of Object.entries(NAICS_FRIENDLY_LABELS)) {
      expect(label.trim().length, `code ${code} has an empty label`).toBeGreaterThan(0);
    }
  });
});

describe("NAICS_CATEGORIES", () => {
  it("gives every category a non-empty label and a non-empty codes array", () => {
    for (const [key, category] of Object.entries(NAICS_CATEGORIES)) {
      expect(category.label.trim().length, `category ${key} has an empty label`).toBeGreaterThan(0);
      expect(category.codes.length, `category ${key} has no codes`).toBeGreaterThan(0);
    }
  });

  it("places every NAICS_FRIENDLY_LABELS code in exactly one category", () => {
    const allCategoryCodes = Object.values(NAICS_CATEGORIES).flatMap((c) => c.codes);

    for (const code of Object.keys(NAICS_FRIENDLY_LABELS)) {
      const occurrences = allCategoryCodes.filter((c) => c === code).length;
      expect(occurrences, `code ${code} should appear in exactly one category`).toBe(1);
    }
  });

  it("does not reference any code that isn't in NAICS_FRIENDLY_LABELS", () => {
    const allCategoryCodes = Object.values(NAICS_CATEGORIES).flatMap((c) => c.codes);

    for (const code of allCategoryCodes) {
      expect(NAICS_FRIENDLY_LABELS[code], `category code ${code} missing from NAICS_FRIENDLY_LABELS`).toBeDefined();
    }
  });

  it("has no duplicate codes across different categories", () => {
    const allCategoryCodes = Object.values(NAICS_CATEGORIES).flatMap((c) => c.codes);
    const uniqueCodes = new Set(allCategoryCodes);

    expect(allCategoryCodes.length).toBe(uniqueCodes.size);
  });
});
