import Anthropic from '@anthropic-ai/sdk'

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (anthropicClient === null) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropicClient
}

export interface RubricDimension {
  name: string
  max_points: number
  weight_percentage: number
  description: string
  common_deductions: string[]
  inferred?: boolean
}

export interface ExtractedRubric {
  dimensions: RubricDimension[]
  total_points: number
  review_type: string
  notes: string
}

export async function extractRubricFromText(
  text: string,
  funderName?: string,
  grantProgram?: string,
): Promise<ExtractedRubric> {
  const systemPrompt = `You are a federal grant reviewer. Extract the scoring rubric from this grant announcement text. Return ONLY valid JSON with no markdown formatting. Structure:
{
  "dimensions": [
    {
      "name": "string (e.g., Need, Approach, Evaluation)",
      "max_points": number,
      "weight_percentage": number,
      "description": "what earns full marks",
      "common_deductions": ["string"]
    }
  ],
  "total_points": number,
  "review_type": "string (peer_review, panel_review, merit_review, internal)",
  "notes": "any additional reviewer guidance found"
}
If no explicit scoring criteria are found, infer likely dimensions based on the funder type and requirements, and set a flag inferred: true on each dimension.`

  const contextParts: string[] = []
  if (funderName) contextParts.push(`Funder: ${funderName}`)
  if (grantProgram) contextParts.push(`Program: ${grantProgram}`)
  const contextPrefix = contextParts.length > 0 ? contextParts.join('\n') + '\n\n' : ''

  const userContent = contextPrefix + text.slice(0, 50000)

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  })

  const block = response.content[0]
  if (!block || block.type !== 'text') {
    throw new Error('No text response from Claude')
  }

  let raw = block.text.trim()
  const fenceMatch = raw.match(/^```(?:json)?\s*([\s\S]*?)```$/m)
  if (fenceMatch) {
    raw = fenceMatch[1]?.trim() ?? raw
  }

  return JSON.parse(raw) as ExtractedRubric
}

export async function extractRubricFromOpportunity(
  opportunityId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
): Promise<ExtractedRubric | null> {
  const { data, error } = await supabase
    .from('opportunities')
    .select('requirements, eligibility_text, description, raw_content, funder_name, title')
    .eq('id', opportunityId)
    .single()

  if (error || !data) return null

  const parts: string[] = [
    data.requirements ?? '',
    data.eligibility_text ?? '',
    data.description ?? '',
    data.raw_content ?? '',
  ]

  const combined = parts.filter(Boolean).join('\n\n')
  if (combined.length < 100) return null

  return extractRubricFromText(combined, data.funder_name ?? undefined, data.title ?? undefined)
}
