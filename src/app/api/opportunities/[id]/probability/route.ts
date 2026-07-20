import { headers } from "next/headers";
import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";
import { computeSuccessProbability } from "@/lib/intelligence/success-probability";

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const orgId = headers().get("x-organization-id");

  if (!user || !orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await computeSuccessProbability(orgId, params.id, supabase);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[opportunities/probability]", err);
    return NextResponse.json(
      { error: "Failed to compute success probability." },
      { status: 404 },
    );
  }
}
