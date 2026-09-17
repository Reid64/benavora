// AR-1.2 — cross-directory agent_type uniqueness guard.
//
// The whole point of giving AutoApply (src/lib/autoapply/**) its own
// autoapply_* agent_type values (see AGENT_TYPE exports added by AR-1.2, and
// src/types/agents.ts's AR-1.2 block) was to make every AutoApply execution
// individually attributable in agent_runs — the exact opposite of the
// shadow-duplicate pattern p5a-002 found and partly fixed among
// src/lib/agents/*.ts files (see agent-type-collision-check.test.ts). This
// test statically scans BOTH src/lib/autoapply/** and src/lib/agents/** for
// declared agent_type values and fails if any value is declared by two
// different files, so that pattern can't silently recur across the new
// AutoApply/agents boundary either.
//
// Pre-existing, product-decided collisions *within* src/lib/agents/** are
// carried forward from agent-type-collision-check.test.ts's own allowlist —
// this test is not the place to relitigate those; see that file's header.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const AGENTS_DIR = join(__dirname, "../../lib/agents");
const AUTOAPPLY_DIR = join(__dirname, "../../lib/autoapply");

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

/** Same grandfathered pairs as agent-type-collision-check.test.ts (both files
 * live in src/lib/agents/, tagged "agents/<path>" here). Do not add to this
 * list to silence a new collision. */
const GRANDFATHERED_COLLISIONS: Record<string, string[]> = {
  corporate_research: ["agents/research/corporate-giving.ts", "agents/corporate-scraper.ts"],
  browser_automation: ["agents/browser-automation.ts", "agents/playwright-agent.ts"],
};

const AGENTS_PATTERNS = [
  /readonly\s+agentType\s*:\s*AgentType\s*=\s*["']([^"']+)["']/g,
  /super\(\s*(?:orgId|SYSTEM_ORG_ID)\s*,\s*["']([^"']+)["']\s*,\s*supabase\s*\)/g,
];

/** AutoApply modules declare their agent_runs.agent_type via a single
 * exported constant (AR-1.2) rather than a BaseAgent field, since they're
 * plain classes/functions called directly from worker/queue-processor.ts. */
const AUTOAPPLY_PATTERNS = [/export\s+const\s+AGENT_TYPE\s*(?::\s*\w+\s*)?=\s*["']([^"']+)["']/g];

function stripLineComments(content: string): string {
  return content
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");
}

function declaredAgentTypes(filePath: string, patterns: RegExp[]): string[] {
  const content = stripLineComments(readFileSync(filePath, "utf8"));
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of content.matchAll(pattern)) {
      const value = match[1];
      if (value) found.push(value);
    }
  }
  return found;
}

function collectDeclarations(): Map<string, string[]> {
  const writers = new Map<string, string[]>();

  const record = (tag: string, dir: string, relPath: string, patterns: RegExp[]): void => {
    const types = declaredAgentTypes(join(dir, relPath), patterns);
    for (const t of types) {
      const list = writers.get(t) ?? [];
      list.push(`${tag}/${relPath}`);
      writers.set(t, list);
    }
  };

  const agentFiles = listTsFilesRecursive(AGENTS_DIR).filter(
    (f) => !f.includes("__tests__") && !f.endsWith(".test.ts"),
  );
  for (const relPath of agentFiles) record("agents", AGENTS_DIR, relPath, AGENTS_PATTERNS);

  const autoapplyFiles = listTsFilesRecursive(AUTOAPPLY_DIR).filter(
    (f) => !f.includes("__tests__") && !f.endsWith(".test.ts"),
  );
  for (const relPath of autoapplyFiles) record("autoapply", AUTOAPPLY_DIR, relPath, AUTOAPPLY_PATTERNS);

  return writers;
}

describe("agent_type uniqueness (src/lib/autoapply/** + src/lib/agents/**)", () => {
  it("no two files declare the same agent_runs.agent_type value outside the grandfathered allowlist", () => {
    const writers = collectDeclarations();

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
      `New agent_type collision(s) detected across src/lib/autoapply/** + src/lib/agents/** ` +
        `(not on the grandfathered allowlist):\n${realCollisions.join("\n")}\n\n` +
        `Give the newer file its own distinct value instead.`,
    ).toEqual([]);
  });

  it("every AR-1.2 autoapply_* value declared in src/lib/autoapply/** is unique to one file", () => {
    const writers = collectDeclarations();
    for (const [agentType, fileList] of writers) {
      if (!agentType.startsWith("autoapply_")) continue;
      expect(Array.from(new Set(fileList)), `"${agentType}"`).toHaveLength(1);
    }
  });

  it("sanity check: the scan finds the AR-1.2 autoapply_* declarations", () => {
    const writers = collectDeclarations();
    const autoapplyValues = Array.from(writers.keys()).filter((k) => k.startsWith("autoapply_"));
    // Guards against the AUTOAPPLY_PATTERNS regex silently matching nothing
    // after a refactor and this test going permanently green.
    expect(autoapplyValues.length).toBeGreaterThanOrEqual(9);
  });
});
