import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";

// Custom API test endpoint.
//
// POST { base_url, auth_type, auth_config } — makes one GET request to the
// supplied URL using the supplied credentials and returns the raw JSON (or
// plain text) response for the user to inspect before saving the connection.
// This runs server-side to bypass CORS restrictions on the target API.
//
// The connection need not be saved first; this endpoint works with form data
// entered but not yet persisted, satisfying the "Test Connection" requirement
// in the Add Connection modal (AGENTS.md Agent 19).
//
// auth_config.key / .token is accepted in plaintext here because this endpoint
// is invoked BEFORE saving, when the user still has the key in the form field.
// After save the key is masked and the user would re-enter it to re-test.

export const runtime = "nodejs";

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

export async function POST(request: Request) {
  const gate = await requireRole("admin");
  if ("error" in gate) return gate.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", "invalid_body", 400);
  }

  const { base_url, auth_type, auth_config } = (body ?? {}) as Record<
    string,
    unknown
  >;

  if (typeof base_url !== "string" || !base_url.trim()) {
    return jsonError("base_url is required.", "missing_field", 400);
  }

  const headers: Record<string, string> = { Accept: "application/json" };
  const cfg = ((auth_config ?? {}) as Record<string, string>);

  if (auth_type === "api_key") {
    const headerName = cfg.header_name ?? "X-Api-Key";
    const key = cfg.key ?? "";
    if (key) headers[headerName] = key;
  } else if (auth_type === "bearer" || auth_type === "oauth") {
    const token = cfg.token ?? cfg.key ?? "";
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  try {
    const response = await fetch(base_url.trim(), {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    let preview: unknown;
    let isJson = false;
    try {
      preview = JSON.parse(text) as unknown;
      isJson = true;
    } catch {
      preview = text.slice(0, 1000);
    }

    return NextResponse.json({
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      isJson,
      preview,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Request failed.";
    return NextResponse.json({
      ok: false,
      status: 0,
      statusText: "Network Error",
      isJson: false,
      preview: message,
    });
  }
}
