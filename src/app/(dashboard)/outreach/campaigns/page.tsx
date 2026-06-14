"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ChevronRight,
  FileText,
  Layers,
  Linkedin,
  Mail,
  Pause,
  Phone,
  Play,
  Plus,
  Send,
} from "lucide-react";

import { Badge, Button, Card, EmptyState, Modal } from "@/components/ui";
import type { BadgeColor } from "@/components/ui";
import { CampaignBuilder } from "@/components/outreach/CampaignBuilder";
import { createClient } from "@/lib/supabase/client";
import { canEdit, useProfile } from "@/lib/hooks/useProfile";
import { formatRelative, humanizeEnum } from "@/lib/utils/formatters";
import type { Enums, Tables } from "@/types/database";

type CampaignStatus = Enums<"campaign_status">;
type OutreachChannel = "email" | "phone" | "mail" | "linkedin";

const CHANNEL_ICONS: Record<OutreachChannel, typeof Mail> = {
  email: Mail,
  phone: Phone,
  mail: FileText,
  linkedin: Linkedin,
};

const CHANNEL_PREFIX_RE = /^\[(email|phone|mail|linkedin)\] /;

function decodeStepChannel(subjectTemplate: string): OutreachChannel {
  const m = CHANNEL_PREFIX_RE.exec(subjectTemplate);
  return (m?.[1] ?? "email") as OutreachChannel;
}

const STATUS_COLOR: Record<CampaignStatus, BadgeColor> = {
  draft: "gray",
  active: "green",
  paused: "yellow",
  completed: "blue",
};

/**
 * Email campaign manager (BLUEPRINT §4.11). Lists drip campaigns with their
 * status, a send-progress bar, and step/contact counts; supports building a new
 * campaign and toggling draft/paused ↔ active. Each row links to the campaign
 * detail page. Reads are RLS-scoped to the organization.
 */
export default function CampaignsPage() {
  const { profile } = useProfile();
  const [campaigns, setCampaigns] = useState<Tables<"email_campaigns">[]>([]);
  /** campaign id → count of emails actually sent. */
  const [sentByCampaign, setSentByCampaign] = useState<Record<string, number>>(
    {},
  );
  /** campaign id → per-channel step counts. */
  const [channelsByCampaign, setChannelsByCampaign] = useState<
    Record<string, Partial<Record<OutreachChannel, number>>>
  >({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const supabase = createClient();
    setLoading(true);
    setError(null);

    const { data, error: loadError } = await supabase
      .from("email_campaigns")
      .select("*")
      .order("created_at", { ascending: false });

    if (loadError) {
      setError("Could not load campaigns.");
      setLoading(false);
      return;
    }
    const rows = data ?? [];
    setCampaigns(rows);

    // Aggregate sent counts per campaign and channel breakdown: steps → sends (RLS-scoped).
    const { data: steps } = await supabase
      .from("campaign_steps")
      .select("id, campaign_id, subject_template");
    const stepToCampaign = new Map(
      (steps ?? []).map((s) => [s.id as string, s.campaign_id as string]),
    );
    const stepIds = [...stepToCampaign.keys()];

    const channelCounts: Record<string, Partial<Record<OutreachChannel, number>>> = {};
    for (const s of steps ?? []) {
      const ch = decodeStepChannel(s.subject_template ?? "");
      const cid = s.campaign_id as string;
      if (!channelCounts[cid]) channelCounts[cid] = {};
      channelCounts[cid][ch] = (channelCounts[cid][ch] ?? 0) + 1;
    }
    setChannelsByCampaign(channelCounts);

    const counts: Record<string, number> = {};
    if (stepIds.length > 0) {
      const { data: sends } = await supabase
        .from("campaign_sends")
        .select("campaign_step_id, sent_at")
        .in("campaign_step_id", stepIds);
      for (const send of sends ?? []) {
        if (!send.sent_at) continue;
        const campaignId = stepToCampaign.get(send.campaign_step_id as string);
        if (campaignId) counts[campaignId] = (counts[campaignId] ?? 0) + 1;
      }
    }
    setSentByCampaign(counts);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function setStatus(id: string, status: CampaignStatus) {
    setBusyId(id);
    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("email_campaigns")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (updateError) {
      setError(updateError.message);
    } else {
      await load();
    }
    setBusyId(null);
  }

  const editable = canEdit(profile?.role);
  const showEmpty = !loading && !error && campaigns.length === 0;

  return (
    <div className="space-y-6">
      <Link
        href="/outreach"
        className="inline-flex items-center gap-1.5 text-sm text-navy-500 transition hover:text-navy-700"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Back to outreach
      </Link>

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-navy-900">
            Campaigns
          </h1>
          <p className="mt-1 text-sm text-navy-500">
            Multi-channel drip sequences for cold outreach contacts.
          </p>
        </div>
        {editable && (
          <Button onClick={() => setBuilding(true)}>
            <Plus className="h-4 w-4" aria-hidden />
            New campaign
          </Button>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
        </div>
      )}

      {showEmpty ? (
        <EmptyState
          icon={Send}
          title="No campaigns yet"
          description="Build a multi-step drip sequence to nurture cold outreach contacts."
          action={
            editable ? (
              <Button onClick={() => setBuilding(true)}>
                <Plus className="h-4 w-4" aria-hidden />
                New campaign
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const status = (campaign.status ?? "draft") as CampaignStatus;
            const canActivate = status === "draft" || status === "paused";
            const canPause = status === "active";
            const steps = campaign.total_steps ?? 0;
            const contacts = campaign.total_contacts ?? 0;
            const planned = steps * contacts;
            const sent = sentByCampaign[campaign.id] ?? 0;
            const pct =
              planned > 0 ? Math.min(100, Math.round((sent / planned) * 100)) : 0;
            return (
              <Card key={campaign.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <Link
                      href={`/outreach/campaigns/${campaign.id}`}
                      className="group flex flex-wrap items-center gap-2"
                    >
                      <p className="font-medium text-navy-900 transition group-hover:text-teal-700">
                        {campaign.name}
                      </p>
                      <Badge color={STATUS_COLOR[status]}>
                        {humanizeEnum(status)}
                      </Badge>
                      <ChevronRight
                        className="h-4 w-4 text-navy-300 transition group-hover:text-teal-600"
                        aria-hidden
                      />
                    </Link>
                    <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-navy-500">
                      <span className="inline-flex items-center gap-1">
                        <Layers className="h-3.5 w-3.5" aria-hidden />
                        {steps} step{steps === 1 ? "" : "s"}
                      </span>
                      {(["email", "phone", "mail", "linkedin"] as OutreachChannel[])
                        .filter((ch) => (channelsByCampaign[campaign.id]?.[ch] ?? 0) > 0)
                        .map((ch) => {
                          const Icon = CHANNEL_ICONS[ch];
                          return (
                            <span key={ch} className="inline-flex items-center gap-0.5">
                              <Icon className="h-3 w-3" aria-hidden />
                              {channelsByCampaign[campaign.id]?.[ch]}
                            </span>
                          );
                        })}
                      <span>·</span>
                      <span>{contacts} contacts</span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1">
                        <Send className="h-3.5 w-3.5" aria-hidden />
                        {sent} sent
                      </span>
                      <span>·</span>
                      <span>Created {formatRelative(campaign.created_at)}</span>
                    </p>
                    {planned > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <div
                          className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-navy-100"
                          role="progressbar"
                          aria-valuenow={pct}
                          aria-valuemin={0}
                          aria-valuemax={100}
                        >
                          <div
                            className="h-full rounded-full bg-teal-500 transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-navy-400">
                          {pct}%
                        </span>
                      </div>
                    )}
                  </div>
                  {editable && (canActivate || canPause) && (
                    <div className="flex shrink-0 items-center gap-2">
                      {canActivate && (
                        <Button
                          variant="secondary"
                          size="sm"
                          isLoading={busyId === campaign.id}
                          onClick={() => setStatus(campaign.id, "active")}
                        >
                          <Play className="h-4 w-4" aria-hidden />
                          {status === "paused" ? "Resume" : "Activate"}
                        </Button>
                      )}
                      {canPause && (
                        <Button
                          variant="secondary"
                          size="sm"
                          isLoading={busyId === campaign.id}
                          onClick={() => setStatus(campaign.id, "paused")}
                        >
                          <Pause className="h-4 w-4" aria-hidden />
                          Pause
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <Modal
        isOpen={building}
        onClose={() => setBuilding(false)}
        title="New campaign"
        size="xl"
      >
        <CampaignBuilder
          organizationId={profile?.organization_id ?? null}
          createdBy={profile?.id ?? null}
          onCancel={() => setBuilding(false)}
          onSaved={async () => {
            setBuilding(false);
            await load();
          }}
        />
      </Modal>
    </div>
  );
}
