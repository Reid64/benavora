import Anthropic from '@anthropic-ai/sdk'
import { createClient } from '@/lib/supabase/server'
import { generateEmbedding } from './embeddings'

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (anthropicClient === null) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropicClient
}

export interface LogicModelData {
  inputs: string[]
  activities: string[]
  outputs: string[]
  outcomes: string[]
  impact: string[]
}

// Carries the five logic-model stages inline (extends LogicModelData) plus the
// resolution metadata, so a GeneratedLogicModel is directly assignable anywhere
// a LogicModelData is expected (e.g. the LogicModelView component and the
// DraftResult.logicModel field) without unwrapping a nested `data` object.
export interface GeneratedLogicModel extends LogicModelData {
  category: string
  templateBased: boolean
  templateId?: string
}

interface LogicModelRow {
  id: string
  category: string
  subcategory: string | null
  inputs: unknown
  activities: unknown
  outputs: unknown
  outcomes: unknown
  impact: unknown
}

const LOGIC_MODEL_COLS = 'id, category, subcategory, inputs, activities, outputs, outcomes, impact'

const SYSTEM_PROMPT = `You are a nonprofit grant writer expert in logic models. Return ONLY valid JSON with no markdown fences. The JSON must match this exact structure:
{
  "inputs": ["string describing a resource or input"],
  "activities": ["string describing a program activity"],
  "outputs": ["string describing a measurable output (e.g., number of people served)"],
  "outcomes": ["string describing a short-term or medium-term change"],
  "impact": ["string describing the long-term community change"]
}
Each array should have 3-6 items. Be specific, measurable, and tailored to the program described.`

function toStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === 'string')
  }
  return []
}

function parseLogicModelJson(raw: string): LogicModelData {
  let text = raw.trim()
  const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```$/m)
  if (fenceMatch) {
    text = fenceMatch[1]?.trim() ?? text
  }
  const parsed = JSON.parse(text) as Record<string, unknown>
  return {
    inputs: toStringArray(parsed['inputs']),
    activities: toStringArray(parsed['activities']),
    outputs: toStringArray(parsed['outputs']),
    outcomes: toStringArray(parsed['outcomes']),
    impact: toStringArray(parsed['impact']),
  }
}

export async function generateLogicModel(params: {
  category: string
  programDescription: string
  organizationName: string
  targetPopulation?: string
  geography?: string
}): Promise<GeneratedLogicModel> {
  const { category, programDescription, organizationName, targetPopulation, geography } = params
  const supabase = createClient()

  // Step 1: exact category match
  const { data: exactMatch } = await supabase
    .from('intelligence_logic_models')
    .select(LOGIC_MODEL_COLS)
    .eq('category', category)
    .limit(1)
    .maybeSingle()

  let template: LogicModelRow | null = exactMatch as LogicModelRow | null

  // Step 2: embedding similarity fallback if no exact match
  if (!template) {
    try {
      const queryText = `${category} ${programDescription}`
      const embedding = await generateEmbedding(queryText)
      const { data: similar } = await supabase.rpc('match_logic_models', {
        query_embedding: embedding,
        match_threshold: 0.6,
        match_count: 1,
      })
      if (Array.isArray(similar) && similar.length > 0) {
        template = similar[0] as LogicModelRow
      }
    } catch {
      // RPC may not be deployed yet; proceed without template
    }
  }

  const contextParts: string[] = [
    `Organization: ${organizationName}`,
    `Program: ${programDescription}`,
  ]
  if (targetPopulation) contextParts.push(`Target Population: ${targetPopulation}`)
  if (geography) contextParts.push(`Geography: ${geography}`)
  const contextBlock = contextParts.join('\n')

  let userContent: string
  if (template) {
    const templateJson = JSON.stringify({
      inputs: toStringArray(template.inputs),
      activities: toStringArray(template.activities),
      outputs: toStringArray(template.outputs),
      outcomes: toStringArray(template.outcomes),
      impact: toStringArray(template.impact),
    }, null, 2)
    userContent = `Here is a template logic model for ${template.category}:\n${templateJson}\n\nCustomize it for this specific program:\n${contextBlock}\n\nAdapt the inputs, activities, outputs, outcomes, and impact to be specific to this program. Return ONLY valid JSON matching the same structure.`
  } else {
    userContent = `Generate a logic model for this program:\n${contextBlock}\n\nCategory: ${category}\n\nReturn ONLY valid JSON.`
  }

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userContent }],
  })

  const block = response.content[0]
  if (!block || block.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  const data = parseLogicModelJson(block.text)

  return {
    ...data,
    category,
    templateBased: template !== null,
    templateId: template?.id,
  }
}

export function formatLogicModelAsText(model: GeneratedLogicModel): string {
  const fmt = (items: string[]): string =>
    items.map((item) => `  - ${item}`).join('\n')

  return [
    `INPUTS:\n${fmt(model.inputs)}`,
    `ACTIVITIES:\n${fmt(model.activities)}`,
    `OUTPUTS:\n${fmt(model.outputs)}`,
    `OUTCOMES:\n${fmt(model.outcomes)}`,
    `IMPACT:\n${fmt(model.impact)}`,
  ].join('\n\n')
}
