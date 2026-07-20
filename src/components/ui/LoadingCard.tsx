export type LoadingCardProps = {
  height?: number;
  width?: string;
  borderRadius?: number;
};

/**
 * Skeleton placeholder with a left-to-right shimmer. The keyframe only
 * animates background-position (no color literals), so the gradient's hex
 * values stay in the inline style per the design system's inline-color rule.
 */
export function LoadingCard({ height = 120, width = "100%", borderRadius = 14 }: LoadingCardProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      style={{
        height: `${height}px`,
        width,
        borderRadius: `${borderRadius}px`,
        background: "linear-gradient(90deg, #1A2B3C 0%, #243550 50%, #1A2B3C 100%)",
        backgroundSize: "200% 100%",
        animation: "loading-card-shimmer 1.5s ease-in-out infinite",
      }}
    >
      <style>{`
        @keyframes loading-card-shimmer {
          0% { background-position: 200% 0; }
          100% { background-position: -200% 0; }
        }
      `}</style>
    </div>
  );
}
