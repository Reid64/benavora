"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/**
 * Dismisses an autonomous draft from the review queue without deleting it —
 * flips applications.pending_review to false via PATCH /api/applications/[id].
 * The parent page filters on pending_review=true, so a router.refresh() after
 * a successful dismiss removes the card from the list.
 */
export function DismissDraftButton({ applicationId }: { applicationId: string }) {
  const router = useRouter();
  const [dismissing, setDismissing] = useState(false);

  async function handleDismiss() {
    setDismissing(true);
    try {
      await fetch(`/api/applications/${applicationId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pending_review: false }),
      });
      router.refresh();
    } finally {
      setDismissing(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleDismiss}
      disabled={dismissing}
      style={{
        backgroundColor: "#F3F4F6",
        color: "#374151",
        fontSize: "13px",
        fontWeight: 600,
        borderRadius: "8px",
        padding: "8px 16px",
        border: "none",
        cursor: dismissing ? "not-allowed" : "pointer",
        opacity: dismissing ? 0.6 : 1,
      }}
    >
      {dismissing ? "Dismissing..." : "Dismiss"}
    </button>
  );
}
