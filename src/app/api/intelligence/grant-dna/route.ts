import { NextRequest, NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth/role-gate'
import { GrantDNAScorer } from '@/lib/intelligence/grant-dna'

export const maxDuration = 300

export async function POST(req: NextRequest) {
  const gate = await requireRole('writer')
  if ('error' in gate) return gate.error

  const body = (await req.json()) as {
    sections?: unknown
    category?: unknown
    grant_type?: unknown
  }
  const { sections, category, grant_type } = body

  if (!sections || typeof sections !== 'object' || Array.isArray(sections)) {
    return NextResponse.json(
      { error: 'sections must be a non-empty Record<string, string>' },
      { status: 400 },
    )
  }

  try {
    const scorer = new GrantDNAScorer()
    const score = await scorer.scoreProposal(
      sections as Record<string, string>,
      typeof grant_type === 'string' ? grant_type : undefined,
    )
    const benchmark = scorer.benchmarkAgainstFunded(
      score,
      typeof category === 'string' ? category : 'default',
    )

    return NextResponse.json({ ...score, ...benchmark })
  } catch {
    return NextResponse.json(
      { error: 'Grant DNA scoring failed.' },
      { status: 500 },
    )
  }
}
