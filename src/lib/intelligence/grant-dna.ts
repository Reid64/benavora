import Anthropic from '@anthropic-ai/sdk'
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { withClaudeLimit } from '@/lib/ai/claude-concurrency'

export interface GrantDNAScore {
  composite: number
  dimensions: Record<string, number>
  recommendations: string[]
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  clarity: 0.15,
  evidence_density: 0.15,
  outcome_specificity: 0.15,
  funder_alignment: 0.15,
  innovation: 0.1,
  sustainability: 0.1,
  feasibility: 0.1,
  impact_scope: 0.1,
}

const FEDERAL_WEIGHTS: Record<string, number> = {
  clarity: 0.1,
  evidence_density: 0.2,
  outcome_specificity: 0.2,
  funder_alignment: 0.15,
  innovation: 0.05,
  sustainability: 0.1,
  feasibility: 0.1,
  impact_scope: 0.1,
}

const CORPORATE_WEIGHTS: Record<string, number> = {
  clarity: 0.15,
  evidence_density: 0.1,
  outcome_specificity: 0.1,
  funder_alignment: 0.15,
  innovation: 0.2,
  sustainability: 0.1,
  feasibility: 0.1,
  impact_scope: 0.1,
}

// Approximate average dimension scores for funded proposals by category
const FUNDED_BENCHMARKS: Record<string, Record<string, number>> = {
  housing: { clarity: 7.5, evidence_density: 8.0, outcome_specificity: 7.8, funder_alignment: 8.2, innovation: 6.5, sustainability: 7.2, feasibility: 8.0, impact_scope: 7.5 },
  health: { clarity: 7.8, evidence_density: 8.5, outcome_specificity: 8.0, funder_alignment: 8.0, innovation: 7.0, sustainability: 7.0, feasibility: 7.8, impact_scope: 7.8 },
  education: { clarity: 8.0, evidence_density: 7.5, outcome_specificity: 7.5, funder_alignment: 7.8, innovation: 7.2, sustainability: 7.5, feasibility: 8.2, impact_scope: 8.0 },
  workforce: { clarity: 7.5, evidence_density: 7.8, outcome_specificity: 8.2, funder_alignment: 7.5, innovation: 6.8, sustainability: 7.8, feasibility: 8.0, impact_scope: 7.2 },
  default: { clarity: 7.5, evidence_density: 7.5, outcome_specificity: 7.5, funder_alignment: 7.5, innovation: 7.0, sustainability: 7.0, feasibility: 7.5, impact_scope: 7.5 },
}

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (anthropicClient === null) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("Missing required env var: ANTHROPIC_API_KEY")
    anthropicClient = createTrackedAnthropic({ apiKey }, "grant-dna")
  }
  return anthropicClient
}

function computeComposite(dimensions: Record<string, number>, weights: Record<string, number>): number {
  let total = 0
  let weightSum = 0
  for (const [key, weight] of Object.entries(weights)) {
    const score = dimensions[key] ?? 0
    total += score * weight
    weightSum += weight
  }
  return weightSum > 0 ? total / weightSum : 0
}

export class GrantDNAScorer {
  async scoreProposal(
    proposalSections: Record<string, string>,
    grantType?: string,
  ): Promise<GrantDNAScore> {
    const weights = this.getWeightsByGrantType(grantType ?? 'default')
    const sectionsText = Object.entries(proposalSections)
      .map(([section, text]) => `## ${section}\n${text}`)
      .join('\n\n')

    const response = await withClaudeLimit(() =>
      getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Score this grant proposal across 8 dimensions. Each dimension: 0-10.

Dimensions:
- clarity: Clear writing, logical structure, easy to follow
- evidence_density: Use of statistics, citations, research backing
- outcome_specificity: Concrete measurable outcomes with targets
- funder_alignment: Alignment with funder priorities
- innovation: Novel approaches or solutions
- sustainability: Plan for long-term sustainability beyond grant period
- feasibility: Realistic budget, timeline, and capacity
- impact_scope: Breadth and depth of community impact

Proposal:
${sectionsText}

Return a JSON object:
{
  "dimensions": {
    "clarity": 0-10,
    "evidence_density": 0-10,
    "outcome_specificity": 0-10,
    "funder_alignment": 0-10,
    "innovation": 0-10,
    "sustainability": 0-10,
    "feasibility": 0-10,
    "impact_scope": 0-10
  },
  "recommendations": ["specific recommendation 1", "specific recommendation 2", "specific recommendation 3"]
}

Return ONLY the JSON object, no preamble.`,
        },
      ],
      }),
    )

    const block = response.content[0]
    if (!block || block.type !== 'text') {
      const zeroDimensions: Record<string, number> = {}
      for (const key of Object.keys(weights)) {
        zeroDimensions[key] = 0
      }
      return { composite: 0, dimensions: zeroDimensions, recommendations: [] }
    }

    try {
      const parsed = JSON.parse(block.text.trim()) as { dimensions?: Record<string, number>; recommendations?: string[] }
      const dimensions = parsed.dimensions ?? {}
      const recommendations = parsed.recommendations ?? []
      const composite = computeComposite(dimensions, weights)
      return { composite, dimensions, recommendations }
    } catch {
      const zeroDimensions: Record<string, number> = {}
      for (const key of Object.keys(weights)) {
        zeroDimensions[key] = 0
      }
      return { composite: 0, dimensions: zeroDimensions, recommendations: [] }
    }
  }

  benchmarkAgainstFunded(
    score: GrantDNAScore,
    category: string,
  ): { percentile: number; comparison: string } {
    const benchmarks = FUNDED_BENCHMARKS[category] ?? FUNDED_BENCHMARKS['default']
    if (!benchmarks) {
      return { percentile: 50, comparison: 'No benchmark data available for this category.' }
    }

    const dimensionKeys = Object.keys(benchmarks)
    let betterCount = 0
    let totalCount = 0

    for (const key of dimensionKeys) {
      const benchmark = benchmarks[key] ?? 7.5
      const actual = score.dimensions[key] ?? 0
      totalCount++
      if (actual >= benchmark) betterCount++
    }

    const percentile = totalCount > 0 ? Math.round((betterCount / totalCount) * 100) : 50

    let comparison: string
    if (percentile >= 75) {
      comparison = `Strong proposal — scores above benchmark in ${betterCount} of ${totalCount} dimensions for ${category} grants.`
    } else if (percentile >= 50) {
      comparison = `Competitive proposal — meets or exceeds benchmark in ${betterCount} of ${totalCount} dimensions for ${category} grants.`
    } else {
      comparison = `Below average — only meets benchmark in ${betterCount} of ${totalCount} dimensions for ${category} grants. Focus on the lowest-scoring dimensions.`
    }

    return { percentile, comparison }
  }

  getWeightsByGrantType(grantType: string): Record<string, number> {
    const type = grantType.toLowerCase()
    if (type === 'federal') return { ...FEDERAL_WEIGHTS }
    if (type === 'corporate') return { ...CORPORATE_WEIGHTS }
    return { ...DEFAULT_WEIGHTS }
  }
}
