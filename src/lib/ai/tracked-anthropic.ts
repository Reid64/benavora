import Anthropic from "@anthropic-ai/sdk";

import { recordUsage, type BillingPath } from "@/lib/ai/usage-recorder";

/**
 * An Anthropic client whose `messages.create` records every successful call to
 * ai_usage_log (AR-9.2 recovery).
 *
 * Why this exists: AR-9.2 instrumented the four callClaude* wrappers in
 * src/lib/ai/claude.ts, but ~34 modules never used them -- they each built
 * their own `new Anthropic({ apiKey })` singleton and called
 * `client.messages.create(...)` directly. Adding recordUsage() to each of those
 * call sites individually is precisely how AR-7.1 shipped a launcher that
 * covered five of six sites. Instead the client itself is instrumented once
 * here, so a module opts in by changing how it CONSTRUCTS the client -- a
 * single line per file -- and every present and future `messages.create` on
 * that client is covered automatically.
 *
 * Recording is strictly best-effort and never throws: an already-successful
 * Anthropic response must never be turned into a failure by a ledger write.
 * The response object is returned untouched, so call sites keep reading
 * `.content` / `.usage` exactly as before.
 *
 * Non-streaming only, which matches every current call site (no `stream: true`
 * or `messages.stream()` exists in this repo). A streaming response carries no
 * `.usage` on the returned object, so it is simply left unrecorded rather than
 * recorded as zero.
 */
export function createTrackedAnthropic(
  options: ConstructorParameters<typeof Anthropic>[0],
  /** Identifies the calling module in ai_usage_log.endpoint, e.g. "pattern-engine". */
  source: string,
  /**
   * 'api' (default) for runtime agents burning ANTHROPIC_API_KEY.
   * 'subscription' for FORGE build-time runs on the Max plan, which have real
   * token counts but no per-token dollar cost.
   */
  billingPath: BillingPath = "api",
): Anthropic {
  const client = new Anthropic(options);
  const messages = client.messages;
  const originalCreate = messages.create.bind(messages);

  // Cast: we deliberately preserve the SDK's overloaded call signature for
  // callers while wrapping the runtime behaviour. The wrapper returns a plain
  // Promise rather than the SDK's APIPromise, which is safe here because no
  // call site uses APIPromise-only methods (.withResponse(), .asResponse()).
  const trackedCreate = (async (...args: Parameters<typeof originalCreate>) => {
    const startedAt = Date.now();
    const response = await originalCreate(...args);

    const usage = (response as { usage?: { input_tokens?: number; output_tokens?: number } })
      .usage;
    const model = (response as { model?: string }).model;

    if (usage && typeof model === "string") {
      await recordUsage(
        source,
        model,
        usage.input_tokens ?? 0,
        usage.output_tokens ?? 0,
        Date.now() - startedAt,
        billingPath,
      );
    }

    return response;
  }) as unknown as typeof messages.create;

  messages.create = trackedCreate;
  return client;
}
