// Disaster Response Agent — PLATFORM_VISION_ARCHITECTURE.md Pillar 10,
// AGENTS_v2.md AG-25 ("5:00 AM — Disaster Response Agent (poll FEMA)").
//
// Two plain functions, matching the sendMorningDigest pattern (no agent_type
// enum value, no Claude call, nothing logged to agent_runs):
//   - pollFEMADeclarations: fetches recent FEMA disaster declarations,
//     inserts any not already in disaster_declarations, returns the new
//     count plus the ids of the newly inserted rows (needed by
//     worker/autonomous-orchestrator.ts's runDisasterResponsePipeline to
//     know which declarations to chain a response for — see row #130
//     "Auto-Deploy Response").
//   - deployDisasterResponse: marks a declaration deployed for one org and
//     raises an alert summarizing matched emergency fund programs.

// Endpoint name is case-sensitive on FEMA's side — confirmed live 2026-08-07
// while verifying row #130 (AGENT_VERIFICATION_LOG.md): the lowercase-'d'
// path this constant previously used ("disasterDeclarationsSummaries") 404s;
// FEMA's real OpenFEMA v2 endpoint is "DisasterDeclarationsSummaries"
// (capital D). This function has never successfully polled FEMA in
// production until this fix — every prior invocation threw at the `!response.ok`
// check below before inserting or returning anything.
const FEMA_URL =
  "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries?$orderby=declarationDate desc&$top=20&$format=json";

interface FemaDeclaration {
  disasterNumber?: number | string;
  declarationType?: string;
  incidentType?: string;
  state?: string;
  declarationDate?: string;
  incidentBeginDate?: string;
}

interface FemaResponse {
  DisasterDeclarationsSummaries?: FemaDeclaration[];
}

function normaliseDate(val: string | undefined): string | null {
  if (!val) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(val);
  return match ? (match[1] ?? null) : null;
}

export interface FemaPollResult {
  /** Count of newly inserted declarations — kept for the existing GET
   * /api/agents/disaster response contract (`{ newDeclarations: number }`). */
  newCount: number;
  /** ids of the newly inserted disaster_declarations rows, in insertion
   * order — empty when nothing new was found. */
  newDeclarationIds: string[];
}

/**
 * Fetches the most recent FEMA disaster declarations and inserts any not
 * already present in disaster_declarations (deduped by fema_disaster_number).
 * Returns the newly inserted count and ids.
 */
export async function pollFEMADeclarations(supabase: any): Promise<FemaPollResult> {
  const response = await fetch(FEMA_URL, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) {
    throw new Error(`FEMA API returned HTTP ${response.status}.`);
  }

  const body = (await response.json()) as FemaResponse;
  const declarations = body.DisasterDeclarationsSummaries ?? [];

  let newCount = 0;
  const newDeclarationIds: string[] = [];
  for (const item of declarations) {
    if (item.disasterNumber === undefined || item.disasterNumber === null) {
      continue;
    }
    const femaNumber = String(item.disasterNumber);

    const { data: existing } = await supabase
      .from("disaster_declarations")
      .select("id")
      .eq("fema_disaster_number", femaNumber)
      .maybeSingle();
    if (existing) continue;

    const { data: inserted, error } = await supabase
      .from("disaster_declarations")
      .insert({
        fema_disaster_number: femaNumber,
        disaster_type: item.declarationType ?? null,
        incident_type: item.incidentType ?? null,
        affected_states: item.state ? [item.state] : null,
        declaration_date: normaliseDate(item.declarationDate),
        incident_begin_date: normaliseDate(item.incidentBeginDate),
      })
      .select("id")
      .single();
    if (!error && inserted) {
      newCount++;
      newDeclarationIds.push((inserted as { id: string }).id);
    }
  }

  return { newCount, newDeclarationIds };
}

export interface DisasterResponseDeployment {
  declarationId: string;
  orgId: string;
  matchedFunds: number;
  alertCreated: boolean;
}

/**
 * Deploys a disaster response for one org against one declaration: marks the
 * declaration as deployed, looks up active emergency funds matching its
 * disaster/incident type, and raises a single alert summarizing the match.
 */
export async function deployDisasterResponse(
  declarationId: string,
  orgId: string,
  supabase: any,
): Promise<DisasterResponseDeployment> {
  const { data: declaration, error: declError } = await supabase
    .from("disaster_declarations")
    .select(
      "id, fema_disaster_number, disaster_type, incident_type, affected_states",
    )
    .eq("id", declarationId)
    .single();
  if (declError || !declaration) {
    throw new Error("Disaster declaration not found.");
  }

  const relevantTypes = [declaration.disaster_type, declaration.incident_type].filter(
    (t: unknown): t is string => typeof t === "string" && t.length > 0,
  );

  let matchedFunds = 0;
  if (relevantTypes.length > 0) {
    const { count } = await supabase
      .from("disaster_emergency_funds")
      .select("id", { count: "exact", head: true })
      .eq("active", true)
      .overlaps("disaster_types", relevantTypes);
    matchedFunds = count ?? 0;
  }

  const states =
    declaration.affected_states && declaration.affected_states.length > 0
      ? declaration.affected_states.join(", ")
      : "affected areas";
  const message =
    `Disaster response deployed for FEMA declaration ${declaration.fema_disaster_number} ` +
    `(${states}). ${matchedFunds} emergency fund program(s) matched.`;

  const { error: alertError } = await supabase.from("alerts").insert({
    organization_id: orgId,
    type: "system",
    severity: "warning",
    message,
    dedup_key: `disaster-response:${declaration.fema_disaster_number}:${orgId}`,
  });

  await supabase
    .from("disaster_declarations")
    .update({
      response_deployed: true,
      response_deployed_at: new Date().toISOString(),
    })
    .eq("id", declarationId);

  return {
    declarationId,
    orgId,
    matchedFunds,
    alertCreated: !alertError,
  };
}
