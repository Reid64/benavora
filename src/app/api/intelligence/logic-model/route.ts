import { NextResponse } from 'next/server'

import { requireRole } from '@/lib/auth/role-gate'
import { createAdminClient } from '@/lib/supabase/admin'
import { generateLogicModel, type GeneratedLogicModel } from '@/lib/intelligence/logic-model-generator'

export const runtime = 'nodejs'
export const dynamic = "force-dynamic";
export const maxDuration = 300

function jsonError(message: string, code: string, status: number) {
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(request: Request) {
  // Generating a logic model calls Claude and, with save_to_library, writes
  // to the shared intelligence_logic_models table via the admin client — a
  // write action, gated accordingly (mirrors need-data's POST convention).
  const gate = await requireRole('writer')
  if ('error' in gate) return gate.error
  const { supabase } = gate

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return jsonError('Request body must be valid JSON.', 'invalid_body', 400)
  }

  const {
    category,
    program_description,
    organization_id,
    target_population,
    geography,
    save_to_library,
  } = (body ?? {}) as {
    category?: unknown
    program_description?: unknown
    organization_id?: unknown
    target_population?: unknown
    geography?: unknown
    save_to_library?: unknown
  }

  if (typeof category !== 'string' || category.trim() === '') {
    return jsonError('category is required.', 'missing_category', 400)
  }
  if (typeof program_description !== 'string' || program_description.trim() === '') {
    return jsonError('program_description is required.', 'missing_program_description', 400)
  }
  if (typeof organization_id !== 'string' || organization_id.trim() === '') {
    return jsonError('organization_id is required.', 'missing_organization_id', 400)
  }

  // organization_id is verified against the session-derived value — never
  // trusted from the body alone (Behavioral Contracts §2).
  if (gate.organizationId !== organization_id) {
    return jsonError('You do not have access to this organization.', 'forbidden', 403)
  }

  // Fetch organization name
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('id', organization_id)
    .single()

  if (!org) {
    return jsonError('Organization not found.', 'org_not_found', 404)
  }

  let logicModel: GeneratedLogicModel
  try {
    logicModel = await generateLogicModel({
      category: category.trim(),
      programDescription: program_description.trim(),
      organizationName: org.name as string,
      targetPopulation: typeof target_population === 'string' ? target_population : undefined,
      geography: typeof geography === 'string' ? geography : undefined,
    })
  } catch {
    return jsonError('Logic model generation failed.', 'generation_failed', 500)
  }

  if (save_to_library === true) {
    const adminClient = createAdminClient()
    await adminClient.from('intelligence_logic_models').insert({
      category: logicModel.category,
      subcategory: null,
      inputs: logicModel.inputs,
      activities: logicModel.activities,
      outputs: logicModel.outputs,
      outcomes: logicModel.outcomes,
      impact: logicModel.impact,
      source: 'user_generated',
      is_template: false,
    })
  }

  return NextResponse.json({ success: true, logic_model: logicModel })
}
