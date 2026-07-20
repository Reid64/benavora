"use client";

import { Component, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

export type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  error: Error | null;
};

/**
 * Catches render errors in its subtree (including thrown/rejected Server
 * Component children rendered inside a Suspense boundary) and shows an
 * inline fallback instead of taking down the whole page.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  override state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override render() {
    const { error } = this.state;
    if (!error) {
      return this.props.children;
    }

    return (
      <div
        style={{
          backgroundColor: "#FFFFFF",
          borderLeft: "4px solid #EF4444",
          borderRadius: "12px",
          padding: "20px 24px",
          boxShadow: "0 2px 12px rgba(0,0,0,0.08)",
          display: "flex",
          alignItems: "flex-start",
          gap: "14px",
        }}
      >
        <AlertTriangle
          size={20}
          color="#EF4444"
          aria-hidden
          style={{ flexShrink: 0, marginTop: "2px" }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: "14px", fontWeight: 700, color: "#1A2B3C" }}>
            Something went wrong
          </div>
          {process.env.NODE_ENV === "development" && (
            <div
              style={{
                fontSize: "12px",
                color: "#6B7280",
                marginTop: "6px",
                wordBreak: "break-word",
              }}
            >
              {error.message}
            </div>
          )}
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              marginTop: "12px",
              backgroundColor: "#EF4444",
              color: "#FFFFFF",
              fontSize: "12px",
              fontWeight: 700,
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              cursor: "pointer",
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }
}
