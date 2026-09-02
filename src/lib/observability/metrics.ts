/**
 * Prometheus metrics registry. Scraped via `src/app/api/metrics/route.ts`.
 *
 * Next.js re-evaluates this module on every dev-mode hot reload and can hold
 * more than one route handler instance alive in the same process, so a plain
 * `new Counter(...)` at module scope throws prom-client's "metric already
 * registered" error the second time the module loads. `metric()` guards
 * against that by returning the already-registered instance instead of
 * constructing a duplicate.
 */
import client, { Counter, Gauge, Histogram, type Registry } from "prom-client";

export const register: Registry = client.register;

// Exported so other observability modules (e.g. flag-metrics.ts) that need
// their own metrics can reuse the same hot-reload-safe registration guard
// instead of duplicating it.
export function counter<T extends string>(config: ConstructorParameters<typeof Counter<T>>[0]): Counter<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as Counter<T>;
  return new Counter<T>(config);
}

export function histogram<T extends string>(config: ConstructorParameters<typeof Histogram<T>>[0]): Histogram<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as Histogram<T>;
  return new Histogram<T>(config);
}

export function gauge<T extends string>(config: ConstructorParameters<typeof Gauge<T>>[0]): Gauge<T> {
  const existing = register.getSingleMetric(config.name);
  if (existing) return existing as Gauge<T>;
  return new Gauge<T>(config);
}

// User actions
export const applicationSubmitted = counter({
  name: "benavora_application_submitted_total",
  help: "Total applications submitted to funders",
  labelNames: ["funder_category", "request_type", "success"],
});

export const draftCreated = counter({
  name: "benavora_draft_created_total",
  help: "Total drafts created",
  labelNames: ["draft_type"],
});

export const opportunityDiscovered = counter({
  name: "benavora_opportunity_discovered_total",
  help: "Total opportunities discovered",
  labelNames: ["source_system", "category"],
});

// Agent operations
export const agentRunDuration = histogram({
  name: "benavora_agent_run_duration_seconds",
  help: "PIL agent execution duration",
  labelNames: ["agent_id", "family", "status"],
  buckets: [1, 5, 10, 30, 60, 120, 300],
});

export const agentEventsLogged = counter({
  name: "benavora_agent_events_total",
  help: "Total PIL agent events",
  labelNames: ["agent_id", "event_type", "severity"],
});

export const prospectIntelligenceComplete = counter({
  name: "benavora_prospect_intelligence_complete_total",
  help: "Total prospects with complete dossiers",
  labelNames: ["fit_level"], // high, medium, low, investigate
});

// System health
export const apiLatency = histogram({
  name: "benavora_api_latency_ms",
  help: "API endpoint latency",
  labelNames: ["endpoint", "method", "status"],
  buckets: [10, 50, 100, 500, 1000, 5000],
});

export const supabaseQueryTime = histogram({
  name: "benavora_supabase_query_ms",
  help: "Supabase query duration",
  labelNames: ["table", "operation"],
  buckets: [5, 25, 50, 250, 1000],
});

export const authFailures = counter({
  name: "benavora_auth_failures_total",
  help: "Authentication failures",
  labelNames: ["reason"], // invalid_token, expired, user_disabled, unauthenticated, forbidden
});

export const activeOrganizations = gauge({
  name: "benavora_active_organizations",
  help: "Count of active organizations",
});

export const subscriptionRevenue = gauge({
  name: "benavora_subscription_revenue_usd",
  help: "Monthly recurring revenue",
});
