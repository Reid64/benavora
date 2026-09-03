"use client";

export type EmptyStateCardProps = {
  icon: string;
  title: string;
  description: string;
  actionLabel?: string;
  onAction?: () => void;
};

/**
 * Dark-surface empty state (distinct from the existing light `EmptyState` in
 * this directory, which 60+ pages already depend on with a different prop
 * shape). Named EmptyStateCard to avoid colliding with that shared component.
 */
export function EmptyStateCard({ icon, title, description, actionLabel, onAction }: EmptyStateCardProps) {
  return (
    <div
      style={{
        backgroundColor: "#2C4E3B",
        borderRadius: "14px",
        padding: "56px 24px",
        textAlign: "center",
        boxShadow: "0 4px 16px rgba(26,43,60,0.2)",
      }}
    >
      <div style={{ fontSize: "48px", lineHeight: 1, marginBottom: "16px" }} aria-hidden>
        {icon}
      </div>
      <div style={{ fontSize: "18px", fontWeight: 700, color: "#FFFFFF" }}>{title}</div>
      <div
        style={{
          fontSize: "14px",
          color: "#8BA8C8",
          marginTop: "8px",
          maxWidth: "420px",
          marginLeft: "auto",
          marginRight: "auto",
        }}
      >
        {description}
      </div>
      {actionLabel && onAction && (
        <button
          type="button"
          onClick={onAction}
          style={{
            marginTop: "24px",
            backgroundColor: "#3D6B50",
            color: "#FFFFFF",
            fontSize: "13px",
            fontWeight: 700,
            padding: "10px 24px",
            borderRadius: "10px",
            border: "none",
            cursor: "pointer",
          }}
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}
