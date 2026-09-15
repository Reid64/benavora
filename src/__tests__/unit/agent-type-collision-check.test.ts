// Collision-prevention check — p5a-002 (2026-09-15).
//
// AGENT_INVENTORY_COMPLETE.md §3 found 9 groups of src/lib/agents/*.ts files
// silently writing the SAME agent_runs.agent_type value, making DB rows
// unattributable to a specific implementation. 7 of those groups were
// resolved by giving the shadow/dormant file its own distinct value (already
// live in the DB enum — see src/types/agents.ts's p5a-002 block). This test
// is the "don't let it happen again" guard: it statically scans every file
// in src/lib/agents/ for its declared agent_type/agentId literal and fails
// if two DIFFERENT files declare the same one, unless that pair is on the
// grandfathered ALLOWLIST below.
//
// The allowlist exists because 2 of the 9 original groups turned out to be
// two genuinely live, independently-wired implementations sharing one bucket
// by what looks like deliberate categorization (not an accidental copy-paste
// duplicate) — see AGENTS_v2.md's collision table. Renaming either without a
// product decision on which should keep the canonical bucket risks silently
// dropping real runs out of existing dashboards/analytics that filter on the
// shared value. Grandfathered here rather than guessed.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const AGENTS_DIR = join(__dirname, "../../lib/agents");

/** Recursively lists .ts files under `dir`, returned as paths relative to `dir`. */
function listTsFilesRecursive(dir: string, base: string = dir): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...listTsFilesRecursive(full, base));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      out.push(full.slice(base.length + 1).replace(/\\/g, "/"));
    }
  }
  return out;
}

/** [file relative to src/lib/agents/, declared agent_type] pairs that are
 * KNOWN, pre-existing, both-genuinely-live collisions — not accidental drift.
 * Do not add to this list to silence a new collision; resolve it per
 * p5a-002's pattern instead (give the newer/shadow file its own DB enum
 * value) or get an explicit product decision first. */
const GRANDFATHERED_COLLISIONS: Record<string, string[]> = {
  corporate_research: ["research/corporate-giving.ts", "corporate-scraper.ts"],
  browser_automation: ["browser-automation.ts", "playwright-agent.ts"],
};

/** Matches BaseAgent-style `readonly agentType: AgentType = "value";` and
 * AutonomousAgent-style `super(orgId, "value", supabase)` /
 * `super(SYSTEM_ORG_ID, "value", supabase)` constructor calls — both patterns
 * ultimately write to agent_runs.agent_type (see base-agent.ts / autonomous-base.ts). */
const AGENT_TYPE_PATTERNS = [
  /readonly\s+agentType\s*:\s*AgentType\s*=\s*"([^"]+)"/g,
  /super\(\s*(?:orgId|SYSTEM_ORG_ID)\s*,\s*"([^"]+)"\s*,\s*supabase\s*\)/g,
];

/** Strips `//` line comments (naively — no string-literal awareness needed
 * here since we only care whether a REAL super()/field-init call exists, and
 * this codebase doesn't put "//" inside the relevant string literals). Avoids
 * false positives from doc comments that echo another file's real call, e.g.
 * relationship-builder-agent.ts's own header quoting AutonomousDigestAgent's
 * `super(orgId, "ag-digest", supabase)` as an example. */
function stripLineComments(content: string): string {
  return content
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function declaredAgentTypes(filePath: string): string[] {
  const content = stripLineComments(readFileSync(filePath, "utf8"));
  const found: string[] = [];
  for (const pattern of AGENT_TYPE_PATTERNS) {
    for (const match of content.matchAll(pattern)) {
      const value = match[1];
      if (value) found.push(value);
    }
  }
  return found;
}

describe("agent_type collision guard (src/lib/agents/*.ts)", () => {
  it("no two files declare the same agent_runs.agent_type value outside the grandfathered allowlist", () => {
    const files = listTsFilesRecursive(AGENTS_DIR).filter(
      (f) => !f.includes("__tests__") && !f.endsWith(".test.ts"),
    );

    const writers = new Map<string, string[]>();
    for (const relPath of files) {
      const types = declaredAgentTypes(join(AGENTS_DIR, relPath));
      for (const t of types) {
        const list = writers.get(t) ?? [];
        list.push(relPath);
        writers.set(t, list);
      }
    }

    const realCollisions: string[] = [];
    for (const [agentType, fileList] of writers) {
      const uniqueFiles = Array.from(new Set(fileList));
      if (uniqueFiles.length <= 1) continue;

      const grandfathered = GRANDFATHERED_COLLISIONS[agentType];
      const isFullyGrandfathered =
        grandfathered &&
        uniqueFiles.every((f) => grandfathered.includes(f)) &&
        uniqueFiles.length === grandfathered.length;

      if (!isFullyGrandfathered) {
        realCollisions.push(`"${agentType}": ${uniqueFiles.join(", ")}`);
      }
    }

    expect(
      realCollisions,
      `New agent_type collision(s) detected (not on the grandfathered allowlist):\n${realCollisions.join("\n")}\n\n` +
        `Give the newer file its own distinct value instead (see p5a-002's pattern in AGENTS_v2.md), ` +
        `or add it to GRANDFATHERED_COLLISIONS in this test with a documented reason.`,
    ).toEqual([]);
  });

  it("sanity check: the scan actually finds a realistic number of agent files with declared types", () => {
    const files = listTsFilesRecursive(AGENTS_DIR).filter(
      (f) => !f.includes("__tests__") && !f.endsWith(".test.ts"),
    );
    let declaredCount = 0;
    for (const relPath of files) {
      if (declaredAgentTypes(join(AGENTS_DIR, relPath)).length > 0) declaredCount++;
    }
    // Guards against the regex silently matching nothing after a refactor
    // (e.g. class field syntax changes) and this test going permanently green.
    expect(declaredCount).toBeGreaterThan(30);
  });
});
