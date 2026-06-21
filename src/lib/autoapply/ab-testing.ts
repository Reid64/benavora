/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ABVariant {
  id: string;
  variantName: string;
  pitchStyle: string;
  emphasis: string;
}

export interface TestResults {
  funderCategory: string;
  variants: Array<{
    id: string;
    variantName: string;
    pitchStyle: string;
    emphasis: string;
    submissionCount: number;
    successCount: number;
    conversionRate: number;
    isWinner: boolean;
    active: boolean;
  }>;
}

interface VariantRow {
  id: string;
  organization_id: string;
  funder_category: string;
  variant_name: string;
  pitch_style: string;
  emphasis: string;
  active: boolean;
  submission_count: number;
  success_count: number;
  is_winner: boolean;
  created_at: string;
  updated_at: string;
}

/**
 * Two-proportion z-score for variant 1 vs variant 2.
 * Returns 0 if either sample is empty or the standard error is 0.
 */
function zScore(n1: number, s1: number, n2: number, s2: number): number {
  if (n1 === 0 || n2 === 0) return 0;
  const p1 = s1 / n1;
  const p2 = s2 / n2;
  const pPooled = (s1 + s2) / (n1 + n2);
  const se = Math.sqrt(pPooled * (1 - pPooled) * (1 / n1 + 1 / n2));
  if (se === 0) return 0;
  return (p1 - p2) / se;
}

export class ABTestEngine {
  /**
   * Returns an active A/B test variant for the given org + funder category,
   * or null when no test is running.
   *
   * Selection is weighted by inverse submission_count so that less-tested
   * variants are chosen more frequently, providing faster statistical coverage.
   * Once a winner is declared the winning variant is always returned.
   */
  async getVariant(
    orgId: string,
    funderCategory: string,
    supabase: any,
  ): Promise<ABVariant | null> {
    try {
      const { data } = (await supabase
        .from('ab_test_variants')
        .select('*')
        .eq('organization_id', orgId)
        .eq('funder_category', funderCategory)
        .eq('active', true)) as { data: VariantRow[] | null };

      if (!data || data.length === 0) return null;

      // If a winner has already been declared, always return it.
      const winner = data.find((v) => v.is_winner);
      if (winner) {
        return {
          id: winner.id,
          variantName: winner.variant_name,
          pitchStyle: winner.pitch_style,
          emphasis: winner.emphasis,
        };
      }

      // Inverse-count weighting: less-tested variants get higher probability.
      const weights = data.map((v) => 1 / (v.submission_count + 1));
      const totalWeight = weights.reduce((a, b) => a + b, 0);
      let rand = Math.random() * totalWeight;

      for (let i = 0; i < data.length; i++) {
        rand -= weights[i] ?? 0;
        if (rand <= 0) {
          const v = data[i]!;
          return {
            id: v.id,
            variantName: v.variant_name,
            pitchStyle: v.pitch_style,
            emphasis: v.emphasis,
          };
        }
      }

      // Fallback to last entry (floating-point rounding safety).
      const last = data[data.length - 1]!;
      return {
        id: last.id,
        variantName: last.variant_name,
        pitchStyle: last.pitch_style,
        emphasis: last.emphasis,
      };
    } catch {
      return null;
    }
  }

  /**
   * Records a submission outcome against a variant.
   * After 50+ submissions per variant, checks for a statistically significant
   * winner (>20% relative lift AND z > 1.96) and marks it if found.
   */
  async recordOutcome(
    variantId: string,
    success: boolean,
    supabase: any,
  ): Promise<void> {
    try {
      const { data } = (await supabase
        .from('ab_test_variants')
        .select('*')
        .eq('id', variantId)
        .maybeSingle()) as { data: VariantRow | null };

      if (!data) return;

      const newCount = data.submission_count + 1;
      const newSuccess = data.success_count + (success ? 1 : 0);

      await supabase
        .from('ab_test_variants')
        .update({
          submission_count: newCount,
          success_count: newSuccess,
          updated_at: new Date().toISOString(),
        })
        .eq('id', variantId);

      // Only check for a winner once this variant has enough samples.
      if (newCount >= 50) {
        await this.checkForWinner(
          data.organization_id,
          data.funder_category,
          supabase,
        );
      }
    } catch {
      // Non-fatal — outcome tracking is best-effort.
    }
  }

  /**
   * Compares all active variants in a category and marks a winner when one
   * variant's conversion rate is >20% higher than all others AND that lead
   * is statistically significant at the 95% confidence level (z > 1.96).
   */
  private async checkForWinner(
    orgId: string,
    funderCategory: string,
    supabase: any,
  ): Promise<void> {
    try {
      const { data } = (await supabase
        .from('ab_test_variants')
        .select('*')
        .eq('organization_id', orgId)
        .eq('funder_category', funderCategory)
        .eq('active', true)
        .eq('is_winner', false)) as { data: VariantRow[] | null };

      if (!data || data.length < 2) return;

      // All variants must meet the minimum sample threshold before declaring a winner.
      if (data.some((v) => v.submission_count < 50)) return;

      const sorted = data.slice().sort((a, b) => {
        const rA = a.submission_count > 0 ? a.success_count / a.submission_count : 0;
        const rB = b.submission_count > 0 ? b.success_count / b.submission_count : 0;
        return rB - rA;
      });

      const best = sorted[0]!;
      const second = sorted[1]!;

      const rateBest =
        best.submission_count > 0 ? best.success_count / best.submission_count : 0;
      const rateSecond =
        second.submission_count > 0 ? second.success_count / second.submission_count : 0;

      // Require >20% relative lift AND 95% statistical confidence.
      const hasLift = rateSecond === 0 || rateBest > rateSecond * 1.2;
      const z = zScore(
        best.submission_count,
        best.success_count,
        second.submission_count,
        second.success_count,
      );
      const isSig = z > 1.96;

      if (hasLift && isSig) {
        await supabase
          .from('ab_test_variants')
          .update({ is_winner: true, updated_at: new Date().toISOString() })
          .eq('id', best.id);

        console.log(
          `[ABTestEngine] A/B test winner for ${funderCategory}: ${best.variant_name} at ${(rateBest * 100).toFixed(1)}%`,
        );
      }
    } catch {
      // Non-fatal.
    }
  }

  /**
   * Returns all variants for an org grouped by funder_category,
   * with per-variant conversion rates and winner status.
   */
  async getTestResults(orgId: string, supabase: any): Promise<TestResults[]> {
    try {
      const { data } = (await supabase
        .from('ab_test_variants')
        .select('*')
        .eq('organization_id', orgId)
        .order('funder_category', { ascending: true })
        .order('variant_name', { ascending: true })) as {
        data: VariantRow[] | null;
      };

      if (!data) return [];

      const byCategory = new Map<string, VariantRow[]>();
      for (const v of data) {
        const bucket = byCategory.get(v.funder_category) ?? [];
        bucket.push(v);
        byCategory.set(v.funder_category, bucket);
      }

      return Array.from(byCategory.entries()).map(([category, vars]) => ({
        funderCategory: category,
        variants: vars.map((v) => ({
          id: v.id,
          variantName: v.variant_name,
          pitchStyle: v.pitch_style,
          emphasis: v.emphasis,
          submissionCount: v.submission_count,
          successCount: v.success_count,
          conversionRate:
            v.submission_count > 0 ? v.success_count / v.submission_count : 0,
          isWinner: v.is_winner,
          active: v.active,
        })),
      }));
    } catch {
      return [];
    }
  }
}
