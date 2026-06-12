import { TrendingUp } from "lucide-react";

export type SuccessRatePoint = {
  /** Sort key, e.g. "2026-06". */
  month: string;
  /** Short axis label, e.g. "Jun". */
  label: string;
  /** Awarded / total as a 0-100 percentage, or null when no outcomes that month. */
  rate: number | null;
  /** Outcomes recorded that month (for the point tooltip). */
  total: number;
};

// SVG canvas geometry (unitless; scaled to the container via viewBox).
const W = 480;
const H = 180;
const PAD = { top: 12, right: 10, bottom: 24, left: 30 };
const INNER_W = W - PAD.left - PAD.right;
const INNER_H = H - PAD.top - PAD.bottom;

function xAt(index: number, count: number): number {
  if (count <= 1) return PAD.left + INNER_W / 2;
  return PAD.left + (INNER_W * index) / (count - 1);
}

function yAt(rate: number): number {
  return PAD.top + INNER_H * (1 - rate / 100);
}

/**
 * Monthly success-rate trend (BLUEPRINT §4.1): a line chart of awarded/total
 * over the last 12 months. Months without outcomes have a null rate and break
 * the line (no fabricated zero). Pure SVG, so it renders in a Server Component.
 */
export function SuccessRateChart({ points }: { points: SuccessRatePoint[] }) {
  const withData = points.filter((p) => p.rate !== null);

  if (withData.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <TrendingUp className="h-6 w-6 text-navy-300" aria-hidden />
        <p className="mt-2 text-sm text-navy-500">
          Record application outcomes to see your success-rate trend.
        </p>
      </div>
    );
  }

  const count = points.length;

  // Line segments only between adjacent months that both have a rate, so gaps
  // (months with no outcomes) are not connected across.
  const segments: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (a?.rate != null && b?.rate != null) {
      segments.push({
        x1: xAt(i, count),
        y1: yAt(a.rate),
        x2: xAt(i + 1, count),
        y2: yAt(b.rate),
      });
    }
  }

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Monthly grant success rate over the last 12 months"
      >
        {/* Horizontal gridlines + y-axis labels at 0/50/100% */}
        {[0, 50, 100].map((tick) => {
          const y = yAt(tick);
          return (
            <g key={tick}>
              <line
                x1={PAD.left}
                y1={y}
                x2={W - PAD.right}
                y2={y}
                className="stroke-navy-100"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-navy-400"
                fontSize={10}
              >
                {tick}%
              </text>
            </g>
          );
        })}

        {/* Trend line */}
        {segments.map((s, i) => (
          <line
            key={i}
            x1={s.x1}
            y1={s.y1}
            x2={s.x2}
            y2={s.y2}
            className="stroke-teal-500"
            strokeWidth={2}
            strokeLinecap="round"
          />
        ))}

        {/* Points + x-axis labels */}
        {points.map((p, i) => {
          const x = xAt(i, count);
          return (
            <g key={p.month}>
              {p.rate !== null && (
                <circle
                  cx={x}
                  cy={yAt(p.rate)}
                  r={3}
                  className="fill-teal-500"
                >
                  <title>{`${p.label}: ${p.rate}% (${p.total} outcome${
                    p.total === 1 ? "" : "s"
                  })`}</title>
                </circle>
              )}
              {i % 2 === 0 && (
                <text
                  x={x}
                  y={H - 8}
                  textAnchor="middle"
                  className="fill-navy-400"
                  fontSize={10}
                >
                  {p.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
