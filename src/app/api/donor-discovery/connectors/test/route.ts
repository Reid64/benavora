// POST /api/donor-discovery/connectors/test — validate a BYO API key against
// the real provider before it's saved (DONOR_DISCOVERY_ARCHITECTURE.md §6,
// Behavioral Contracts §20: "Test call required before saving"). Never
// persists anything; the key only round-trips to the provider and back.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import {
  CONNECTOR_PROVIDERS,
  getConnectorProvider,
  isConnectorProvider,
  type DdConnectorProvider,
} from "@/lib/donor-discovery/connector-providers";

export const runtime = "nodejs";

const TEST_TIMEOUT_MS = 8_000;

interface TestResult {
  valid: boolean;
  message: string;
}

async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TEST_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Apollo's documented auth-check endpoint — 200 for a valid key, 401/403 for an invalid one. */
async function testApollo(apiKey: string): Promise<TestResult> {
  try {
    const res = await fetchWithTimeout("https://api.apollo.io/api/v1/auth/health", {
      headers: { "x-api-key": apiKey, "Cache-Control": "no-cache" },
    });
    if (res.ok) return { valid: true, message: "Apollo.io key verified." };
    if (res.status === 401 || res.status === 403) {
      return { valid: false, message: "Apollo.io rejected this key — double-check it and try again." };
    }
    return { valid: false, message: `Apollo.io returned an unexpected status (${res.status}).` };
  } catch {
    return { valid: false, message: "Could not reach Apollo.io to verify the key." };
  }
}

/** Hunter's account endpoint — 200 with account data for a valid key, 401 otherwise. */
async function testHunter(apiKey: string): Promise<TestResult> {
  try {
    const url = new URL("https://api.hunter.io/v2/account");
    url.searchParams.set("api_key", apiKey);
    const res = await fetchWithTimeout(url.toString());
    if (res.ok) return { valid: true, message: "Hunter.io key verified." };
    if (res.status === 401) {
      return { valid: false, message: "Hunter.io rejected this key — double-check it and try again." };
    }
    return { valid: false, message: `Hunter.io returned an unexpected status (${res.status}).` };
  } catch {
    return { valid: false, message: "Could not reach Hunter.io to verify the key." };
  }
}

/** Places always returns HTTP 200 — validity is read from the JSON `status` field. */
async function testGooglePlaces(apiKey: string): Promise<TestResult> {
  try {
    const url = new URL("https://maps.googleapis.com/maps/api/place/nearbysearch/json");
    url.searchParams.set("location", "0,0");
    url.searchParams.set("radius", "1");
    url.searchParams.set("key", apiKey);
    const res = await fetchWithTimeout(url.toString());
    if (!res.ok) {
      return { valid: false, message: `Google Places returned an unexpected status (${res.status}).` };
    }
    const body = (await res.json()) as { status: string; error_message?: string };
    if (body.status === "OK" || body.status === "ZERO_RESULTS") {
      return { valid: true, message: "Google Places key verified." };
    }
    if (body.status === "REQUEST_DENIED") {
      return {
        valid: false,
        message: body.error_message ?? "Google Places rejected this key — double-check it and try again.",
      };
    }
    return { valid: false, message: `Google Places returned ${body.status}.` };
  } catch {
    return { valid: false, message: "Could not reach Google Places to verify the key." };
  }
}

async function runTest(provider: DdConnectorProvider, apiKey: string): Promise<TestResult> {
  switch (provider) {
    case "apollo":
      return testApollo(apiKey);
    case "hunter":
      return testHunter(apiKey);
    case "google_places":
      return testGooglePlaces(apiKey);
    default:
      return { valid: false, message: "This provider does not support key testing yet." };
  }
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { provider, api_key } = (body ?? {}) as { provider?: unknown; api_key?: unknown };

  if (!isConnectorProvider(provider)) {
    return NextResponse.json(
      { error: `provider must be one of: ${CONNECTOR_PROVIDERS.map((p) => p.key).join(", ")}.` },
      { status: 400 },
    );
  }
  const config = getConnectorProvider(provider);
  if (!config.connectable) {
    return NextResponse.json(
      { error: `${config.name} is coming soon and cannot be connected yet.` },
      { status: 400 },
    );
  }
  if (typeof api_key !== "string" || !api_key.trim()) {
    return NextResponse.json({ error: "api_key is required." }, { status: 400 });
  }

  const result = await runTest(provider, api_key.trim());
  return NextResponse.json(result);
}
