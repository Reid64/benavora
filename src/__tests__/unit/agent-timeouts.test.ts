// AR-2.1 (defect B): BaseAgent's default AGENT_TIMEOUT_MS is 60s
// (src/lib/agents/base-agent.ts), which is correct for deterministic agents
// but too short for anything that makes a Claude call - live agent_runs
// showed review, budget_builder, foundation_research, government_research,
// and local_sponsorship all failing with "Agent timed out after 60s.".
// Every BaseAgent subclass that imports the Claude SDK (directly or via
// src/lib/ai/claude.ts) must now override timeoutMs in its constructor.
// This is a static-analysis test, not a runtime one: it greps the agent
// source files rather than instantiating each agent, so it also catches a
// future agent that adds a Claude call without adding a timeout override.
//
// AR-11.4: the ad-hoc numeric literals this test originally grepped for
// (180_000/270_000/280_000/300_000) were consolidated into the two named,
// documented per-class constants AGENT_TIMEOUT_CLAUDE_CALL_MS (180s) and
// AGENT_TIMEOUT_MULTI_STEP_MS (270s) exported from base-agent.ts - both
// resolved here to their real values so this test keeps grepping real
// numbers rather than needing every agent file to still spell out a raw
// literal.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import {
  AGENT_TIMEOUT_CLAUDE_CALL_MS,
  AGENT_TIMEOUT_MULTI_STEP_MS,
} from "@/lib/agents/base-agent";

const REPO_ROOT = join(__dirname, "..", "..", "..");
const AGENTS_DIR = join(REPO_ROOT, "src", "lib", "agents");
const MIN_TIMEOUT_MS = 60_000;
const NAMED_TIMEOUT_CONSTANTS: Record<string, number> = {
  AGENT_TIMEOUT_CLAUDE_CALL_MS,
  AGENT_TIMEOUT_MULTI_STEP_MS,
};

function walk(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, out);
    } else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) {
      out.push(full);
    }
  }
}

function extendsBaseAgentDirectly(src: string): boolean {
  // Deliberately narrow to `extends BaseAgent` (not AutonomousAgent or any
  // other base class) - that's the class whose default timeout this test
  // guards, and the only one AR-2.1 was scoped to fix.
  return /extends\s+BaseAgent\b/.test(src);
}

function callsClaudeSdk(src: string): boolean {
  return (
    /from\s+["']@\/lib\/ai\/claude["']/.test(src) ||
    /from\s+["']@anthropic-ai\/sdk["']/.test(src)
  );
}

/** Every numeric or named-constant timeoutMs value found in the file, in ms. */
function declaredTimeouts(src: string): number[] {
  const patterns = [
    /timeoutMs:\s*options\.timeoutMs\s*\?\?\s*([\w]+)/g,
    /timeoutMs:\s*([\w]+)\s*[,}]/g,
  ];
  const values: number[] = [];
  for (const pattern of patterns) {
    for (const match of src.matchAll(pattern)) {
      const token = match[1];
      if (!token) continue;
      if (/^[\d_]+$/.test(token)) {
        values.push(Number(token.replace(/_/g, "")));
      } else if (token in NAMED_TIMEOUT_CONSTANTS) {
        values.push(NAMED_TIMEOUT_CONSTANTS[token] as number);
      }
    }
  }
  return values;
}

describe("BaseAgent subclasses that call Claude declare a >60s timeout", () => {
  it("every BaseAgent subclass importing the Claude SDK overrides timeoutMs above 60000", () => {
    const files: string[] = [];
    walk(AGENTS_DIR, files);

    const offenders: string[] = [];

    for (const file of files) {
      const src = readFileSync(file, "utf8");
      if (!extendsBaseAgentDirectly(src)) continue;
      if (!callsClaudeSdk(src)) continue;

      const timeouts = declaredTimeouts(src);
      const hasSufficientOverride = timeouts.some((ms) => ms > MIN_TIMEOUT_MS);

      if (!hasSufficientOverride) {
        offenders.push(relative(REPO_ROOT, file));
      }
    }

    expect(
      offenders,
      offenders.length > 0
        ? `BaseAgent subclasses calling Claude without a >60000ms timeoutMs override:\n${offenders.join("\n")}`
        : undefined,
    ).toEqual([]);
  });
});
