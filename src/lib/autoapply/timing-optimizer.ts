// Seasonal timing optimizer for AutoApply submission scheduling.
// Returns how optimal the current month is for submitting to a given funder type.

export interface TimingScoreParams {
  funderType: string;
  funderCategory?: string | null;
  /** Month (1-12) of the funder's fiscal year end, when known from 990 data. */
  funderFiscalYearEnd?: number | null;
}

export interface TimingScoreResult {
  score: number;
  explanation: string;
  optimalMonths: number[];
}

export interface DelayResult {
  delay: boolean;
  delayUntilMonth?: number;
}

// Month constants (1-based)
const Q1 = [1, 2, 3];
const Q2 = [4, 5, 6];
const Q3 = [7, 8, 9];
const Q4 = [10, 11, 12];

function getCurrentMonth(): number {
  return new Date().getMonth() + 1;
}

function normalizeFunderType(funderType: string, funderCategory: string | null): string {
  const lower = funderType.toLowerCase();
  if (lower === 'government' || lower === 'gov') return 'government';
  if (lower === 'foundation') return 'foundation';
  if (lower === 'community') return 'community';
  if (lower === 'corporate') return 'corporate';

  if (funderCategory) {
    const cat = funderCategory.toLowerCase();
    if (cat.includes('government') || cat === 'housing_grant' || cat === 'education_grant' || cat === 'local_community_grant') {
      return 'government';
    }
    if (cat.includes('foundation') || cat.includes('faith')) {
      return 'foundation';
    }
    if (cat === 'local_community_grant') {
      return 'community';
    }
  }

  return 'corporate';
}

/**
 * Returns a timing score (0.0–1.0) representing how optimal the current month
 * is for submitting to a funder of the given type.
 *
 * Corporate:   Q4=1.0, Q1=0.8, Q3=0.6, Q2=0.5
 * Foundation:  0.7 uniform, or 0.9 at fiscal-year start / 0.8 at fiscal-year end
 * Government:  Sep–Nov=0.9, Dec–Feb=0.7, otherwise 0.5
 * Community:   Spring (Mar–May) + Fall (Sep–Nov)=0.9, otherwise 0.5
 */
export function getTimingScore(params: TimingScoreParams): TimingScoreResult {
  const { funderType, funderCategory, funderFiscalYearEnd } = params;
  const month = getCurrentMonth();
  const normalizedType = normalizeFunderType(funderType, funderCategory ?? null);

  if (normalizedType === 'government') {
    const optimalMonths = [9, 10, 11];
    if (optimalMonths.includes(month)) {
      return {
        score: 0.9,
        explanation: 'Federal fiscal year start (Oct) — prime government grant window',
        optimalMonths,
      };
    }
    if ([12, 1, 2].includes(month)) {
      return {
        score: 0.7,
        explanation: 'Q1 government cycle — active grant period',
        optimalMonths,
      };
    }
    return {
      score: 0.5,
      explanation: 'Mid-cycle for government grants',
      optimalMonths,
    };
  }

  if (normalizedType === 'foundation') {
    // Quarterly board meeting months as the default optimal window.
    const boardMonths = [1, 4, 7, 10];

    if (funderFiscalYearEnd != null) {
      // New FY starts the month after fiscal year end.
      const newFyMonth = (funderFiscalYearEnd % 12) + 1;
      const optimalMonths = [newFyMonth, (newFyMonth % 12) + 1];
      if (optimalMonths.includes(month)) {
        return {
          score: 0.9,
          explanation: "Start of funder's fiscal year — new budget approved",
          optimalMonths,
        };
      }
      if (month === funderFiscalYearEnd) {
        return {
          score: 0.8,
          explanation: "Approaching funder's fiscal year end — spend-down period",
          optimalMonths,
        };
      }
    }

    if (boardMonths.includes(month)) {
      return {
        score: 0.8,
        explanation: 'Typical quarterly board meeting cycle — optimal for foundation grants',
        optimalMonths: boardMonths,
      };
    }
    return {
      score: 0.7,
      explanation: 'Foundation grants: moderate timing, board meets quarterly',
      optimalMonths: boardMonths,
    };
  }

  if (normalizedType === 'community') {
    const spring = [3, 4, 5];
    const fall = [9, 10, 11];
    const optimalMonths = [...spring, ...fall];
    if (spring.includes(month)) {
      return {
        score: 0.9,
        explanation: 'Spring community grant cycle — high conversion window',
        optimalMonths,
      };
    }
    if (fall.includes(month)) {
      return {
        score: 0.9,
        explanation: 'Fall community grant cycle — high conversion window',
        optimalMonths,
      };
    }
    return {
      score: 0.5,
      explanation: 'Off-cycle for community grants',
      optimalMonths,
    };
  }

  // Corporate (default)
  if (Q4.includes(month)) {
    return {
      score: 1.0,
      explanation: 'Q4 giving season — highest corporate donation conversion',
      optimalMonths: Q4,
    };
  }
  if (Q1.includes(month)) {
    return {
      score: 0.8,
      explanation: 'Q1 new corporate budget cycle — strong giving window',
      optimalMonths: Q4,
    };
  }
  if (Q3.includes(month)) {
    return {
      score: 0.6,
      explanation: 'Q3 — moderate timing for corporate giving',
      optimalMonths: Q4,
    };
  }
  // Q2
  return {
    score: 0.5,
    explanation: 'Q2 — slower corporate giving cycle',
    optimalMonths: Q4,
  };
}

/**
 * Returns whether to delay submission based on score vs threshold.
 * Pass optimalMonths from getTimingScore to get a concrete delayUntilMonth.
 */
export function shouldDelaySubmission(
  score: number,
  threshold = 0.6,
  optimalMonths?: number[],
): DelayResult {
  if (score >= threshold) return { delay: false };

  if (optimalMonths && optimalMonths.length > 0) {
    const currentMonth = getCurrentMonth();
    const future = optimalMonths.filter((m) => m > currentMonth);
    const delayUntilMonth = future.length > 0 ? future[0] : optimalMonths[0];
    return { delay: true, delayUntilMonth };
  }

  return { delay: true };
}
