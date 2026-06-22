import Anthropic from '@anthropic-ai/sdk'

export interface NarrativePattern {
  type: string
  description: string
  frequency: number
  win_rate: number
  examples: string[]
  category: string
}

export interface PatternScore {
  overall: number
  dimensions: {
    clarity: number
    evidence_density: number
    outcome_specificity: number
    funder_alignment: number
    readability: number
  }
}

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (anthropicClient === null) {
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  }
  return anthropicClient
}

export class NarrativePatternEngine {
  async extractPatterns(proposalSections: unknown[]): Promise<NarrativePattern[]> {
    if (proposalSections.length === 0) return []

    const sectionsJson = JSON.stringify(proposalSections, null, 2)

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [
        {
          role: 'user',
          content: `Analyze these funded proposal sections and identify recurring narrative patterns. Look for:
- Opening hooks: statistic-led, story-led, authority-led
- Evidence density: how frequently statistics/citations appear
- Outcome specificity: concrete measurable outcomes vs vague claims
- Transition structures: how sections connect
- Section length distributions

Proposal sections:
${sectionsJson}

Return a JSON array of patterns with this exact structure:
[{
  "type": "opening_hook_statistic" | "opening_hook_story" | "opening_hook_authority" | "high_evidence_density" | "outcome_specificity" | "transition_structure" | "section_length",
  "description": "description of the pattern",
  "frequency": 0.0-1.0,
  "win_rate": 0.0-1.0,
  "examples": ["example text snippet 1", "example text snippet 2"],
  "category": "opening" | "evidence" | "outcomes" | "transitions" | "structure"
}]

Return ONLY the JSON array, no preamble.`,
        },
      ],
    })

    const block = response.content[0]
    if (!block || block.type !== 'text') return []

    try {
      const parsed = JSON.parse(block.text.trim()) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed as NarrativePattern[]
    } catch {
      return []
    }
  }

  async scoreSection(sectionText: string, sectionType: string): Promise<PatternScore> {
    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: `Score this ${sectionType} grant proposal section against winning patterns. Return scores 0-10 for each dimension.

Section:
${sectionText}

Return a JSON object with this exact structure:
{
  "overall": 0-10,
  "dimensions": {
    "clarity": 0-10,
    "evidence_density": 0-10,
    "outcome_specificity": 0-10,
    "funder_alignment": 0-10,
    "readability": 0-10
  }
}

Return ONLY the JSON object, no preamble.`,
        },
      ],
    })

    const block = response.content[0]
    if (!block || block.type !== 'text') {
      return {
        overall: 0,
        dimensions: {
          clarity: 0,
          evidence_density: 0,
          outcome_specificity: 0,
          funder_alignment: 0,
          readability: 0,
        },
      }
    }

    try {
      const parsed = JSON.parse(block.text.trim()) as unknown
      return parsed as PatternScore
    } catch {
      return {
        overall: 0,
        dimensions: {
          clarity: 0,
          evidence_density: 0,
          outcome_specificity: 0,
          funder_alignment: 0,
          readability: 0,
        },
      }
    }
  }

  async suggestImprovements(
    sectionText: string,
    sectionType: string,
    patterns: NarrativePattern[],
  ): Promise<string[]> {
    const patternsJson = JSON.stringify(patterns, null, 2)

    const response = await getClient().messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [
        {
          role: 'user',
          content: `Based on the following winning narrative patterns, suggest specific improvements for this ${sectionType} grant proposal section.

Winning patterns:
${patternsJson}

Section to improve:
${sectionText}

Return a JSON array of specific, actionable improvement suggestions:
["suggestion 1", "suggestion 2", "suggestion 3"]

Each suggestion should reference a specific pattern and explain exactly how to apply it. Return ONLY the JSON array, no preamble.`,
        },
      ],
    })

    const block = response.content[0]
    if (!block || block.type !== 'text') return []

    try {
      const parsed = JSON.parse(block.text.trim()) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed as string[]
    } catch {
      return []
    }
  }
}
