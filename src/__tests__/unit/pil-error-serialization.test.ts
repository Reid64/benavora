// Unit tests for src/lib/pil/serialize-error.ts (AR-1.1).
//
// Root cause this guards against: `err instanceof Error ? err.message :
// String(err)` was the repo-wide pattern for turning a caught error into
// text before writing it to pil_agent_runs.error. Supabase-js throws plain
// PostgrestError objects (not Error instances) from `if (error) throw
// error;` -- so `String(plainObject)` silently produced the literal string
// "[object Object]", which is exactly what live production data showed for
// BEN-QLF-04 (3/3 failed runs) and BEN-QLF-03 (1/1 failed run).
import { describe, it, expect } from "vitest";
import { serializePilError } from "@/lib/pil/serialize-error";

describe("serializePilError", () => {
  it("formats an Error instance as `name: message` plus up to 5 stack frames", () => {
    const err = new Error("boom");
    const result = serializePilError(err);
    expect(result.startsWith("Error: boom")).toBe(true);
    const frameCount = result.split("\n").length - 1;
    expect(frameCount).toBeLessThanOrEqual(5);
  });

  it("formats a custom Error subclass using its own name", () => {
    class PolicyViolationError extends Error {
      constructor(message: string) {
        super(message);
        this.name = "PolicyViolationError";
      }
    }
    const result = serializePilError(new PolicyViolationError("denied"));
    expect(result.startsWith("PolicyViolationError: denied")).toBe(true);
  });

  it("uses .message for a plain object that has a string message field", () => {
    const err = { message: "something went wrong", extra: "ignored" };
    expect(serializePilError(err)).toBe("something went wrong");
  });

  it("formats a Supabase PostgrestError-shaped object with code/message/details/hint", () => {
    const err = {
      code: "23505",
      message: "duplicate key value violates unique constraint",
      details: "Key (id)=(1) already exists.",
      hint: null,
    };
    expect(serializePilError(err)).toBe(
      "23505: duplicate key value violates unique constraint | details: Key (id)=(1) already exists. | hint: null",
    );
  });

  it("prefers the PostgrestError branch over the generic has-message branch when both shapes match", () => {
    const err = { code: "PGRST116", message: "no rows found", details: null, hint: "check filters" };
    const result = serializePilError(err);
    expect(result).toContain("PGRST116");
    expect(result).toContain("check filters");
  });

  it("JSON.stringifies a plain object with no message field", () => {
    const err = { foo: "bar", count: 3 };
    expect(serializePilError(err)).toBe(JSON.stringify(err));
  });

  it("truncates a large plain object to 2000 chars", () => {
    const err = { data: "x".repeat(5000) };
    const result = serializePilError(err);
    expect(result.length).toBeLessThanOrEqual(2000);
  });

  it("returns a string input unchanged", () => {
    expect(serializePilError("plain string error")).toBe("plain string error");
  });

  it("returns a fixed placeholder for null", () => {
    expect(serializePilError(null)).toBe("(no error value provided)");
  });

  it("returns a fixed placeholder for undefined", () => {
    expect(serializePilError(undefined)).toBe("(no error value provided)");
  });

  it("stringifies primitives that aren't strings", () => {
    expect(serializePilError(404)).toBe("404");
    expect(serializePilError(false)).toBe("false");
  });

  it("never returns the literal string \"[object Object]\" for any object-shaped input", () => {
    const candidates: unknown[] = [
      {},
      { toString: () => "[object Object]" },
      Object.create(null),
      { message: 123 }, // message present but not a string -- falls through to JSON branch
      new Error("wrapped"),
      { code: "500", message: "server error", details: "d", hint: "h" },
      { nested: { deeply: { value: [1, 2, 3] } } },
      [1, 2, 3],
      new Map([["a", 1]]),
    ];

    for (const candidate of candidates) {
      const result = serializePilError(candidate);
      expect(result).not.toBe("[object Object]");
    }
  });

  it("falls back to JSON.stringify if a plain object's own String() coercion would be the literal '[object Object]'", () => {
    const err = { deliberatelyNoMessage: true };
    expect(String(err)).toBe("[object Object]");
    const result = serializePilError(err);
    expect(result).not.toBe("[object Object]");
    expect(result).toBe(JSON.stringify(err));
  });
});
