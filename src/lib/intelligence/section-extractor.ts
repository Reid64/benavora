import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { withClaudeLimit } from '@/lib/ai/claude-concurrency'

const anthropic = createTrackedAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY }, "section-extractor")

export interface ExtractedSections {
  executive_summary?: string
  need_statement?: string
  problem_framing?: string
  program_design?: string
  methodology?: string
  outcomes?: string
  evaluation_plan?: string
  sustainability?: string
  budget_narrative?: string
  capacity?: string
  partnerships?: string
}

export async function extractSections(fullText: string): Promise<ExtractedSections> {
  const truncated = fullText.slice(0, 100_000)

  const response = await withClaudeLimit(() =>
    anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      system:
        'You are a grant application analyst. Extract the following sections from the provided grant application text. Return ONLY valid JSON with no markdown formatting. Keys: executive_summary, need_statement, problem_framing, program_design, methodology, outcomes, evaluation_plan, sustainability, budget_narrative, capacity, partnerships. For each key, provide the relevant text verbatim from the application. If a section is not identifiable, set it to null.',
      messages: [{ role: 'user', content: truncated }],
    }),
  )

  const raw = response.content[0]?.type === 'text' ? response.content[0].text : ''
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  try {
    return JSON.parse(cleaned) as ExtractedSections
  } catch {
    return {}
  }
}

export async function scoreSectionQuality(
  sectionType: string,
  sectionText: string,
): Promise<number> {
  const response = await withClaudeLimit(() =>
    anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 100,
      system: `You are a grant reviewer. Score the quality of this ${sectionType} section on a scale of 1.0 to 10.0. Consider: specificity, evidence usage, clarity, completeness, and persuasiveness. Return ONLY a number.`,
      messages: [{ role: 'user', content: sectionText }],
    }),
  )

  const raw = response.content[0]?.type === 'text' ? response.content[0].text.trim() : ''
  const parsed = parseFloat(raw)
  return isNaN(parsed) ? 5.0 : Math.min(10.0, Math.max(1.0, parsed))
}
