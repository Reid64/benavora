// Next's webpack build (this repo's next.config.mjs / Next 14.2.35) does not
// handle the "node:"-prefixed scheme for this module -- bare "async_hooks"
// resolves the same built-in via webpack's normal Node externals handling.
import { AsyncLocalStorage } from "async_hooks";

// AR-9.2: per-run attribution for cost recording. Set once at the run
// boundary (BaseAgent.run / AutonomousAgent.startRun) so every downstream
// Anthropic call made through src/lib/ai/claude.ts -- however many layers
// deep inside a subclass's execute()/run() -- can attribute its
// ai_usage_log row back to the org and agent_runs row that incurred it,
// without threading organizationId/runId through every intermediate
// function signature between the agent and callClaude().
export interface UsageContext {
  organizationId: string;
  agentType: string;
  agentRunId?: string | null;
}

const storage = new AsyncLocalStorage<UsageContext>();

/** Runs `fn` with `context` active for its entire async chain. */
export function runWithUsageContext<T>(
  context: UsageContext,
  fn: () => Promise<T>,
): Promise<T> {
  return storage.run(context, fn);
}

/**
 * Sets `context` for the remainder of the current async chain without a
 * wrapping callback -- for callers like AutonomousAgent, whose subclasses
 * call startRun() once and then keep working inline rather than handing
 * control to a closure.
 */
export function enterUsageContext(context: UsageContext): void {
  storage.enterWith(context);
}

export function getUsageContext(): UsageContext | undefined {
  return storage.getStore();
}
