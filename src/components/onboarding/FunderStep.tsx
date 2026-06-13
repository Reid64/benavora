"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";

import { Button } from "@/components/ui";
import { FunderForm } from "@/components/funders/FunderForm";

export type FunderStepProps = {
  /** Whether the org already has at least one funder (returning user). */
  alreadyAdded: boolean;
  /** Called after a funder is created so the wizard can mark the step done. */
  onAdded: () => void;
};

/**
 * Step 4 - add the first funder. Reuses the full FunderForm (BLUEPRINT §4.2),
 * which derives organization_id from the session and handles duplicate warnings.
 * We intercept onSaved so creation advances the wizard instead of navigating to
 * the funder detail page.
 */
export function FunderStep({ alreadyAdded, onAdded }: FunderStepProps) {
  const [added, setAdded] = useState(alreadyAdded);
  const [adding, setAdding] = useState(!alreadyAdded);

  if (added && !adding) {
    return (
      <div className="space-y-5">
        <div className="flex items-center gap-2 rounded-xl border border-teal-200 bg-teal-50 px-5 py-4 text-sm text-teal-800">
          <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
          <span>
            Your first funder is in the CRM. You can add more anytime from the
            Funders page.
          </span>
        </div>
        <Button variant="secondary" onClick={() => setAdding(true)}>
          Add another funder
        </Button>
      </div>
    );
  }

  return (
    <FunderForm
      onSaved={() => {
        setAdded(true);
        setAdding(false);
        onAdded();
      }}
      onCancel={added ? () => setAdding(false) : undefined}
    />
  );
}
