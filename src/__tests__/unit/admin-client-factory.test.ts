// WGR-158: worker/index.ts used to construct its own raw Supabase
// service-role client instead of routing through the shared factory
// (src/lib/supabase/admin.ts's createAdminClient()), and read a different
// env var name than that factory did — so a passing worker boot check
// still let every real Donor Discovery request fail once it called into
// src/lib/ code that used the (differently-configured) factory. This test
// enforces there is exactly one place in the codebase allowed to construct
// a Supabase client directly from `createClient()` (the raw
// @supabase/supabase-js export, not the @supabase/ssr session helpers) —
// src/lib/supabase/admin.ts itself — so a future module can't silently
// reintroduce a second, differently-configured construction site.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const SCAN_DIRS = ["worker", "src/lib"];
const EXCLUDED_DIR_NAMES = new Set(["node_modules", "dist", "__tests__"]);
// The one legitimate construction site.
const ALLOWED_FILE = join("src", "lib", "supabase", "admin.ts");

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry)) continue;
      walk(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".d.ts")) {
      out.push(full);
    }
  }
}

/**
 * True if `source` both (a) value-imports `createClient` from the raw
 * `@supabase/supabase-js` package (ignoring `import type { ... }`, which
 * carries no runtime risk), AND (b) actually *calls* it — `createClient(`
 * or `createClient<Generic>(` — somewhere not immediately preceded by
 * `typeof`. (b) matters because a file can legitimately value-import
 * `createClient` purely to reference its return type, e.g.
 * `ReturnType<typeof createClient<Database>>`, without ever constructing a
 * client itself — that pattern is fine and must not be flagged.
 */
function importsRawCreateClient(source: string): boolean {
  const importStatementRe =
    /import\s+(type\s+)?\{([^}]*)\}\s+from\s+["']@supabase\/supabase-js["']/g;
  let imported = false;
  let match: RegExpExecArray | null;
  while ((match = importStatementRe.exec(source)) !== null) {
    const isTypeOnly = Boolean(match[1]);
    if (isTypeOnly) continue;
    const specifiers = match[2] ?? "";
    // Matches `createClient` or `createClient as X`, but not `type createClient`
    // mixed into an otherwise-value import (e.g. `{ type SupabaseClient, createClient }`).
    const hasValueCreateClient = specifiers
      .split(",")
      .map((s) => s.trim())
      .some((s) => !s.startsWith("type ") && /^createClient(\s+as\s+\w+)?$/.test(s));
    if (hasValueCreateClient) {
      imported = true;
      break;
    }
  }
  if (!imported) return false;

  const callRe = /createClient\s*(<[^>]*>)?\s*\(/g;
  let callMatch: RegExpExecArray | null;
  while ((callMatch = callRe.exec(source)) !== null) {
    const before = source.slice(Math.max(0, callMatch.index - 12), callMatch.index);
    if (/typeof\s*$/.test(before)) continue; // `typeof createClient<...>` — type position, not a call
    return true;
  }
  return false;
}

describe("admin-client-factory (WGR-158)", () => {
  it("only src/lib/supabase/admin.ts imports createClient directly from @supabase/supabase-js", () => {
    const files: string[] = [];
    for (const dir of SCAN_DIRS) {
      walk(join(REPO_ROOT, dir), files);
    }
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const rel = relative(REPO_ROOT, file);
      if (rel === ALLOWED_FILE) continue;
      const source = readFileSync(file, "utf8");
      if (importsRawCreateClient(source)) {
        violations.push(rel);
      }
    }

    expect(violations, `Found direct createClient() usage outside the shared factory:\n${violations.join("\n")}`).toEqual([]);
  });

  it("sanity check: the detector itself flags a fixture file that imports createClient", () => {
    const fixture = `import { createClient } from "@supabase/supabase-js";\nconst x = createClient("a", "b");\n`;
    expect(importsRawCreateClient(fixture)).toBe(true);
  });

  it("sanity check: the detector does not flag a type-only import", () => {
    const fixture = `import type { SupabaseClient } from "@supabase/supabase-js";\n`;
    expect(importsRawCreateClient(fixture)).toBe(false);
  });

  it("sanity check: the detector does not flag a mixed type/value import with only the type used", () => {
    const fixture = `import { type SupabaseClient } from "@supabase/supabase-js";\n`;
    expect(importsRawCreateClient(fixture)).toBe(false);
  });

  it("sanity check: the detector does not flag createClient value-imported but only used via typeof (credential-manager.ts's real pattern)", () => {
    const fixture = [
      `import { createClient } from "@supabase/supabase-js";`,
      `type Client = ReturnType<typeof createClient<Database>>;`,
      `class X { constructor(private supabase: ReturnType<typeof createClient<Database>>) {} }`,
    ].join("\n");
    expect(importsRawCreateClient(fixture)).toBe(false);
  });

  it("sanity check: the detector flags a real call even alongside a typeof usage in the same file", () => {
    const fixture = [
      `import { createClient } from "@supabase/supabase-js";`,
      `type Client = ReturnType<typeof createClient<Database>>;`,
      `const real = createClient(url, key);`,
    ].join("\n");
    expect(importsRawCreateClient(fixture)).toBe(true);
  });
});
