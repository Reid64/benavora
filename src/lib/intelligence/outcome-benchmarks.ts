import { callClaude } from '@/lib/ai/claude'

import { OUTCOME_BENCHMARKS } from './data/outcome-benchmarks'

export type { OutcomeBenchmark } from './data/outcome-benchmarks'
import type { OutcomeBenchmark } from './data/outcome-benchmarks'

export interface ComparisonResult {
  metric: string
  benchmark_low: number
  benchmark_median: number
  benchmark_high: number
  unit: string
  actual_value: number | null
  position: 'above' | 'at' | 'below' | 'unknown'
  source: string
}

export class OutcomeBenchmarkEngine {
  async getBenchmarks(programCategory: string, _geography?: string): Promise<OutcomeBenchmark[]> {
    const key = programCategory.toLowerCase().replace(/[\s-]+/g, '_')

    const direct = OUTCOME_BENCHMARKS[key]
    if (direct) return direct

    // Fuzzy match against known keys
    const knownKeys = Object.keys(OUTCOME_BENCHMARKS)
    const matched = knownKeys.find(
      (k) => k.includes(key) || key.includes(k),
    )
    return matched ? (OUTCOME_BENCHMARKS[matched] ?? []) : []
  }

  compareToActual(
    orgOutcomes: { metric: string; value: number }[],
    benchmarks: OutcomeBenchmark[],
  ): ComparisonResult[] {
    return benchmarks.map((benchmark) => {
      const actual = orgOutcomes.find(
        (o) => o.metric.toLowerCase() === benchmark.metric.toLowerCase(),
      )

      if (!actual) {
        return {
          metric: benchmark.metric,
          benchmark_low: benchmark.typical_range.low,
          benchmark_median: benchmark.typical_range.median,
          benchmark_high: benchmark.typical_range.high,
          unit: benchmark.typical_range.unit,
          actual_value: null,
          position: 'unknown' as const,
          source: benchmark.source,
        }
      }

      let position: 'above' | 'at' | 'below'
      const { low, median, high } = benchmark.typical_range
      const spread = high - low
      const tolerance = spread * 0.1

      if (actual.value >= median - tolerance && actual.value <= median + tolerance) {
        position = 'at'
      } else if (actual.value > median + tolerance) {
        position = 'above'
      } else {
        position = 'below'
      }

      return {
        metric: benchmark.metric,
        benchmark_low: low,
        benchmark_median: median,
        benchmark_high: high,
        unit: benchmark.typical_range.unit,
        actual_value: actual.value,
        position,
        source: benchmark.source,
      }
    })
  }

  async generateOutcomeProjection(
    programDescription: string,
    category: string,
  ): Promise<string> {
    const benchmarks = await this.getBenchmarks(category)

    const benchmarkSummary =
      benchmarks.length > 0
        ? benchmarks
            .map(
              (b) =>
                `- ${b.metric}: ${b.typical_range.low}–${b.typical_range.high}${b.typical_range.unit} (median ${b.typical_range.median}${b.typical_range.unit}); Source: ${b.source}`,
            )
            .join('\n')
        : 'No specific benchmarks available for this category.'

    const prompt = `You are a nonprofit program evaluation expert. Based on the program description and published outcome benchmarks below, project realistic 12-month outcomes for this program.

Program Description:
${programDescription.slice(0, 3000)}

Published Benchmarks for "${category}" programs:
${benchmarkSummary}

Write a concise outcome projection (3–5 sentences) that:
1. States specific projected outcome numbers grounded in the benchmark ranges
2. Explains any factors in the program description that would push outcomes above or below the median
3. Cites the benchmark sources to establish credibility
4. Is written in a tone appropriate for a grant application narrative`

    const response = await callClaude({ prompt, maxTokens: 600 })
    return response.text || ''
  }
}
