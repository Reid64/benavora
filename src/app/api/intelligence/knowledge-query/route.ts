import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { queryKnowledgeEngine } from "@/lib/intelligence/knowledge-engine";

// POST /api/intelligence/knowledge-query
//
// Accepts { query, orgId } in the request body. orgId falls back to the
// x-organization-id header (set server-side by middleware.ts from the
// authenticated user's profile) when the body omits it, matching the
// grant-probability route's convention. queryKnowledgeEngine() itself
// writes the best-effort knowledge_queries log row (RLS-scoped to orgId),
// so this route does not log separately.

export async function POST(request: Request) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const { query, orgId: bodyOrgId } = (body ?? {}) as {
    query?: unknown;
    orgId?: unknown;
  };

  if (typeof query !== "string" || query.trim() === "") {
    return NextResponse.json(
      { error: "query is required." },
      { status: 400 },
    );
  }

  const orgId =
    typeof bodyOrgId === "string" && bodyOrgId.trim() !== ""
      ? bodyOrgId.trim()
      : headers().get("x-organization-id");

  if (!orgId) {
    return NextResponse.json({ error: "orgId is required." }, { status: 400 });
  }

  try {
    const result = await queryKnowledgeEngine(query.trim(), orgId, supabase);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Failed to query the knowledge engine.",
      },
      { status: 500 },
    );
  }
}
