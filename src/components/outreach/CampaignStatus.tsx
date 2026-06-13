"use client";

import { CheckCircle, Clock, Mail, MailOpen, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { formatRelative } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type SendStatus = Enums<"campaign_step_status">;

const STATUS_COLOR: Record<SendStatus, BadgeColor> = {
  pending: "gray",
  sent: "blue",
  opened: "teal",
  replied: "green",
  bounced: "red",
};

const STATUS_ICON: Record<SendStatus, React.FC<{ className?: string }>> = {
  pending: Clock,
  sent: Mail,
  opened: MailOpen,
  replied: CheckCircle,
  bounced: XCircle,
};

type SendRow = Tables<"campaign_sends"> & {
  step?: { step_number: number; subject_template: string } | null;
};

export type CampaignStatusProps = {
  outreachContactId: string;
  campaignId: string;
};

/**
 * Per-contact send history for a campaign (Contracts §13).
 * Shows each step that has been sent, with status badge and timestamps.
 */
export function CampaignStatus({
  outreachContactId,
  campaignId,
}: CampaignStatusProps) {
  const [sends, setSends] = useState<SendRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const supabase = createClient();

    // Load step ids for this campaign first.
    const { data: steps } = await supabase
      .from("campaign_steps")
      .select("id, step_number, subject_template")
      .eq("campaign_id", campaignId)
      .order("step_number");

    if (!steps?.length) {
      setSends([]);
      setLoading(false);
      return;
    }

    const stepIds = steps.map((s) => s.id as string);
    const stepMap = new Map(
      steps.map((s) => [
        s.id as string,
        { step_number: s.step_number as number, subject_template: s.subject_template as string },
      ]),
    );

    const { data: sendRows } = await supabase
      .from("campaign_sends")
      .select("*")
      .eq("outreach_contact_id", outreachContactId)
      .in("campaign_step_id", stepIds)
      .order("sent_at", { ascending: true });

    const enriched: SendRow[] = (sendRows ?? []).map((s) => ({
      ...s,
      step: stepMap.get(s.campaign_step_id as string) ?? null,
    }));

    setSends(enriched);
    setLoading(false);
  }, [outreachContactId, campaignId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <p className="py-2 text-sm text-navy-400">Loading send history...</p>
    );
  }

  if (sends.length === 0) {
    return (
      <p className="py-2 text-sm text-navy-400">No emails sent yet.</p>
    );
  }

  return (
    <ol className="space-y-2">
      {sends.map((send) => {
        const status = (send.status ?? "pending") as SendStatus;
        const Icon = STATUS_ICON[status];
        const stepNum = send.step?.step_number ?? "?";
        const subject = send.step?.subject_template ?? "";

        return (
          <li key={send.id} className="flex items-start gap-3 text-sm">
            <Icon
              className={`mt-0.5 h-4 w-4 shrink-0 ${
                status === "bounced"
                  ? "text-red-500"
                  : status === "replied"
                    ? "text-green-500"
                    : status === "opened"
                      ? "text-teal-500"
                      : "text-navy-400"
              }`}
              aria-hidden
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium text-navy-800">
                  Step {stepNum}
                </span>
                <Badge color={STATUS_COLOR[status]}>{status}</Badge>
              </div>
              {subject && (
                <p className="mt-0.5 truncate text-xs text-navy-500">{subject}</p>
              )}
              <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-navy-400">
                {send.sent_at && (
                  <span>Sent {formatRelative(send.sent_at)}</span>
                )}
                {send.opened_at && (
                  <span>· Opened {formatRelative(send.opened_at)}</span>
                )}
                {send.replied_at && (
                  <span>· Replied {formatRelative(send.replied_at)}</span>
                )}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
