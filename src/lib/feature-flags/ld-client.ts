// Server-side LaunchDarkly client (Node SDK). SERVER-ONLY — never import from a
// Client Component; the SDK key is a secret and this module talks to LaunchDarkly's
// streaming API directly.
//
// The client is created lazily on first flag check rather than at module load. A
// top-level `await ldClient.waitForInitialization()` would mean a missing
// LAUNCHDARKLY_SDK_KEY or a LaunchDarkly outage crashes every route that merely
// imports this module, on every cold start. Instead, initialization failures are
// caught and logged, and evaluation falls back to the caller-supplied default —
// the same fail-safe behavior the SDK already gives an unauthenticated/unreachable
// client, just extended to cover "key isn't set at all" too.

import * as LaunchDarkly from "@launchdarkly/node-server-sdk";

export type LDContext = LaunchDarkly.LDContext;

let clientPromise: Promise<LaunchDarkly.LDClient> | null = null;

async function initClient(): Promise<LaunchDarkly.LDClient> {
  const sdkKey = process.env.LAUNCHDARKLY_SDK_KEY;
  if (!sdkKey) {
    throw new Error("LAUNCHDARKLY_SDK_KEY is not set.");
  }

  const client = LaunchDarkly.init(sdkKey);
  try {
    await client.waitForInitialization({ timeout: 5 });
  } catch (error) {
    console.error(
      "[launchdarkly] client failed to initialize within 5s; flag checks will use their fallback values until it recovers",
      error,
    );
  }
  return client;
}

function getClient(): Promise<LaunchDarkly.LDClient> {
  if (!clientPromise) {
    clientPromise = initClient();
  }
  return clientPromise;
}

/**
 * Evaluates a boolean flag for `context`. Any failure — no SDK key, LaunchDarkly
 * unreachable, unknown flag key — resolves to `fallback` rather than throwing, so a
 * caller gating a half-built feature fails closed instead of taking down the route.
 */
export async function isFeatureEnabled(
  featureKey: string,
  context: LDContext,
  fallback: boolean = false,
): Promise<boolean> {
  try {
    const client = await getClient();
    return await client.boolVariation(featureKey, context, fallback);
  } catch (error) {
    console.error(`[launchdarkly] flag evaluation failed for "${featureKey}"`, error);
    return fallback;
  }
}

/** String-variation counterpart to {@link isFeatureEnabled}, for multivariate flags. */
export async function getFeatureVariant(
  featureKey: string,
  context: LDContext,
  fallback: string = "control",
): Promise<string> {
  try {
    const client = await getClient();
    return await client.stringVariation(featureKey, context, fallback);
  } catch (error) {
    console.error(`[launchdarkly] flag evaluation failed for "${featureKey}"`, error);
    return fallback;
  }
}

/**
 * Flushes queued analytics events and releases the SDK's connection. Only call this
 * from an actual process-shutdown hook — calling it mid-request would break every
 * subsequent flag check in the same warm serverless instance.
 */
export async function closeLDClient(): Promise<void> {
  if (!clientPromise) return;
  const client = await clientPromise.catch(() => null);
  client?.close();
  clientPromise = null;
}
