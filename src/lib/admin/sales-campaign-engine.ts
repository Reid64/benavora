import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { decryptToken } from "@/lib/email/encryption";
import { WarmupEngine } from "@/lib/admin/warmup-engine";
import { EmailComplianceEngine } from "@/lib/admin/compliance";

export type CampaignConfig = {
  name: string;
  description?: string;
  list_id: string;
  sending_domain_ids: string[];
  daily_send_target: number;
  send_window_start: number;
  send_window_end: number;
  send_timezone: string;
  filter_criteria: Record<string, unknown>;
  steps: Array<{
    subject_template: string;
    body_template: string;
    delay_days: number;
  }>;
};

export type SendBatchResult = {
  sent: number;
  failed: number;
  skipped_budget: number;
  skipped_suppressed: number;
};

type SuppressedRow = { email: string };
type ProspectRow = {
  id: string;
  org_name: string;
  email: string | null;
  city: string | null;
  state: string | null;
};
type SendRow = {
  id: string;
  campaign_id: string;
  step_id: string;
  prospect_id: string;
  sending_domain_id: string | null;
  to_address: string;
  from_address: string;
  subject: string;
  body_html: string | null;
};
type DomainRow = {
  id: string;
  domain: string;
  api_key_encrypted: string | null;
};

function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_match, key) => vars[key] ?? "");
}

function getFirstName(orgName: string): string {
  const words = orgName.trim().split(/\s+/);
  return words[0] ?? orgName;
}

function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString();
}

export class SalesCampaignEngine {
  private supabase = createAdminClient();
  private warmup = new WarmupEngine();
  private compliance = new EmailComplianceEngine();

  async createCampaign(config: CampaignConfig): Promise<string> {
    const { data: campaign, error: cErr } = await this.supabase
      .from("sales_campaigns")
      .insert({
        name: config.name,
        description: config.description ?? null,
        list_id: config.list_id,
        sending_domain_ids: config.sending_domain_ids,
        daily_send_target: config.daily_send_target,
        send_window_start: config.send_window_start,
        send_window_end: config.send_window_end,
        send_timezone: config.send_timezone,
        filter_criteria: config.filter_criteria as Record<string, unknown>,
        status: "draft",
      })
      .select("id")
      .single();

    if (cErr || !campaign) {
      throw new Error(`Failed to create campaign: ${cErr?.message ?? "unknown"}`);
    }

    const campaignId = (campaign as { id: string }).id;

    const stepInserts = config.steps.map((step, i) => ({
      campaign_id: campaignId,
      step_number: i + 1,
      subject_template: step.subject_template,
      body_template: step.body_template,
      delay_days: step.delay_days,
    }));

    const { error: sErr } = await this.supabase
      .from("sales_campaign_steps")
      .insert(stepInserts);

    if (sErr) {
      throw new Error(`Failed to create campaign steps: ${sErr.message}`);
    }

    return campaignId;
  }

  async scheduleSends(campaignId: string): Promise<{ scheduled: number }> {
    const { data: campaign, error: cErr } = await this.supabase
      .from("sales_campaigns")
      .select("*")
      .eq("id", campaignId)
      .single();

    if (cErr || !campaign) throw new Error("Campaign not found");

    const c = campaign as {
      id: string;
      list_id: string | null;
      sending_domain_ids: string[];
      daily_send_target: number;
      send_window_start: number;
      send_window_end: number;
      filter_criteria: Record<string, unknown>;
    };

    const { data: steps, error: stErr } = await this.supabase
      .from("sales_campaign_steps")
      .select("*")
      .eq("campaign_id", campaignId)
      .order("step_number", { ascending: true });

    if (stErr || !steps || steps.length === 0) {
      throw new Error("No steps found for campaign");
    }

    const firstStep = steps[0] as { id: string; step_number: number; delay_days: number };

    // Build filter from filter_criteria
    const fc = c.filter_criteria ?? {};
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    let query = this.supabase
      .from("prospects")
      .select("id, org_name, email, city, state")
      .eq("suppressed", false)
      .not("email", "is", null);

    if (c.list_id) {
      query = query.eq("list_id", c.list_id);
    }

    if (Array.isArray(fc["states"]) && (fc["states"] as string[]).length > 0) {
      query = query.in("state", fc["states"] as string[]);
    }
    if (typeof fc["min_revenue"] === "number") {
      query = query.gte("annual_revenue", fc["min_revenue"]);
    }
    if (typeof fc["max_revenue"] === "number") {
      query = query.lte("annual_revenue", fc["max_revenue"]);
    }
    if (Array.isArray(fc["ntee_codes"]) && (fc["ntee_codes"] as string[]).length > 0) {
      query = query.in("ntee_code", fc["ntee_codes"] as string[]);
    }

    // Exclude contacted within 30 days
    query = query.or(
      `last_contacted_at.is.null,last_contacted_at.lt.${thirtyDaysAgo.toISOString()}`,
    );

    const { data: prospects, error: pErr } = await query;
    if (pErr) throw new Error(`Failed to query prospects: ${pErr.message}`);

    const allProspects = (prospects ?? []) as ProspectRow[];

    // Exclude prospects already enrolled in this campaign
    const { data: existingSends } = await this.supabase
      .from("sales_sends")
      .select("prospect_id")
      .eq("campaign_id", campaignId);

    const enrolledIds = new Set(
      ((existingSends ?? []) as { prospect_id: string }[]).map((s) => s.prospect_id),
    );

    const eligible = allProspects.filter((p) => !enrolledIds.has(p.id));

    if (eligible.length === 0) return { scheduled: 0 };

    // Distribute across domains round-robin; respect daily_send_target
    const domainIds = c.sending_domain_ids ?? [];
    if (domainIds.length === 0) throw new Error("No sending domains configured");

    // Fetch domain names for from_address
    const { data: domainsData } = await this.supabase
      .from("sending_domains")
      .select("id, domain")
      .in("id", domainIds);
    const domainNameMap = new Map<string, string>(
      ((domainsData ?? []) as { id: string; domain: string }[]).map((d) => [d.id, d.domain]),
    );

    const windowMinutes =
      (c.send_window_end - c.send_window_start) * 60;
    const maxMinutesPerDomain = windowMinutes;
    // 2 emails per minute per domain cap → slots per domain
    const slotsPerDomain = maxMinutesPerDomain * 2;
    const totalSlots = Math.min(
      eligible.length,
      c.daily_send_target,
      slotsPerDomain * domainIds.length,
    );

    const toInsert: Array<{
      campaign_id: string;
      step_id: string;
      prospect_id: string;
      sending_domain_id: string;
      from_address: string;
      to_address: string;
      subject: string;
      body_html: string;
      status: string;
      scheduled_for: string;
    }> = [];

    const now = new Date();
    const baseDate = new Date(now);
    baseDate.setHours(c.send_window_start, 0, 0, 0);

    for (let i = 0; i < totalSlots; i++) {
      const prospect = eligible[i];
      if (!prospect?.email) continue;

      const domainId = domainIds[i % domainIds.length] ?? domainIds[0];
      if (!domainId) continue;
      const domainName = domainNameMap.get(domainId) ?? domainId;

      // Stagger: 30-second gaps within domain slot (2/min = 1 per 30s)
      const minuteSlot = Math.floor(i / domainIds.length);
      const extraSeconds = (i % domainIds.length) * 30;
      const scheduledFor = new Date(baseDate);
      scheduledFor.setMinutes(
        scheduledFor.getMinutes() + minuteSlot,
        extraSeconds,
        0,
      );

      const vars: Record<string, string> = {
        org_name: prospect.org_name,
        first_name: getFirstName(prospect.org_name),
        city: prospect.city ?? "",
        state: prospect.state ?? "",
      };

      const step = firstStep;
      const subject = renderTemplate(
        (steps[0] as { subject_template: string }).subject_template,
        vars,
      );
      const body = renderTemplate(
        (steps[0] as { body_template: string }).body_template,
        vars,
      );

      toInsert.push({
        campaign_id: campaignId,
        step_id: step.id,
        prospect_id: prospect.id,
        sending_domain_id: domainId,
        from_address: `outreach@${domainName}`,
        to_address: prospect.email,
        subject,
        body_html: body,
        status: "queued",
        scheduled_for: scheduledFor.toISOString(),
      });
    }

    if (toInsert.length === 0) return { scheduled: 0 };

    const { error: iErr } = await this.supabase.from("sales_sends").insert(toInsert);
    if (iErr) throw new Error(`Failed to schedule sends: ${iErr.message}`);

    return { scheduled: toInsert.length };
  }

  async processQueuedSends(): Promise<SendBatchResult> {
    const result: SendBatchResult = {
      sent: 0,
      failed: 0,
      skipped_budget: 0,
      skipped_suppressed: 0,
    };

    const now = new Date().toISOString();
    const { data: sends, error: qErr } = await this.supabase
      .from("sales_sends")
      .select("*")
      .eq("status", "queued")
      .lte("scheduled_for", now)
      .limit(10);

    if (qErr) throw new Error(`Failed to query queued sends: ${qErr.message}`);

    const queued = (sends ?? []) as SendRow[];
    if (queued.length === 0) return result;

    // Load suppression list
    const { data: suppressedData } = await this.supabase
      .from("suppression_list")
      .select("email");
    const suppressed = new Set(
      ((suppressedData ?? []) as SuppressedRow[]).map((r) => r.email.toLowerCase()),
    );

    for (const send of queued) {
      // Check suppression
      if (suppressed.has(send.to_address.toLowerCase())) {
        await this.supabase
          .from("sales_sends")
          .update({ status: "suppressed" })
          .eq("id", send.id);
        result.skipped_suppressed++;
        continue;
      }

      // Check domain budget
      if (send.sending_domain_id) {
        const budget = await this.warmup.getDailyBudget(send.sending_domain_id);
        if (budget.remaining <= 0) {
          result.skipped_budget++;
          continue;
        }
      }

      // Load domain API key
      let apiKey: string | null = null;
      let fromAddress = send.from_address;

      if (send.sending_domain_id) {
        const { data: domainRow } = await this.supabase
          .from("sending_domains")
          .select("domain, api_key_encrypted")
          .eq("id", send.sending_domain_id)
          .single();

        if (domainRow) {
          const dr = domainRow as DomainRow;
          if (dr.api_key_encrypted) {
            apiKey = decryptToken(dr.api_key_encrypted);
          }
          fromAddress = `outreach@${dr.domain}`;
        }
      }

      if (!apiKey) {
        await this.supabase
          .from("sales_sends")
          .update({ status: "failed", error_message: "No API key for domain" })
          .eq("id", send.id);
        result.failed++;
        continue;
      }

      // Enforce CAN-SPAM compliance before sending
      const complianceResult = this.compliance.enforceCompliance({
        from: fromAddress,
        to: send.to_address,
        subject: send.subject,
        body_html: send.body_html ?? "",
      });

      let finalBodyHtml = send.body_html ?? send.subject;
      if (!complianceResult.compliant) {
        if (complianceResult.modified_body) {
          // Auto-fixed body — use the compliant version
          finalBodyHtml = complianceResult.modified_body;
        } else {
          // Cannot auto-fix — skip this send
          const violationSummary = complianceResult.violations.join("; ");
          await this.supabase
            .from("sales_sends")
            .update({ status: "failed", error_message: `CAN-SPAM violation: ${violationSummary}`.slice(0, 500) })
            .eq("id", send.id);
          result.failed++;
          continue;
        }
      }

      // Send via Resend
      try {
        const resendRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddress,
            to: [send.to_address],
            subject: send.subject,
            html: finalBodyHtml,
          }),
        });

        if (!resendRes.ok) {
          const errText = await resendRes.text();
          await this.supabase
            .from("sales_sends")
            .update({ status: "failed", error_message: errText.slice(0, 500) })
            .eq("id", send.id);
          result.failed++;
          continue;
        }

        const resendPayload = (await resendRes.json()) as { id?: string };
        const sentAt = new Date().toISOString();

        await this.supabase
          .from("sales_sends")
          .update({
            status: "sent",
            sent_at: sentAt,
            resend_message_id: resendPayload.id ?? null,
          })
          .eq("id", send.id);

        // Advance the sequence: schedule the next step for this prospect, if
        // one exists and hasn't already been scheduled. Previously this never
        // happened — every campaign was effectively single-touch regardless
        // of how many steps it was configured with.
        await this.scheduleNextStep(send, sentAt).catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : "unknown error";
          console.warn(`[SalesCampaignEngine] Failed to schedule next step for send ${send.id}: ${msg}`);
        });

        // Update prospect
        const { data: prospectRow } = await this.supabase
          .from("prospects")
          .select("total_emails_sent")
          .eq("id", send.prospect_id)
          .single();

        const currentCount =
          (prospectRow as { total_emails_sent: number } | null)?.total_emails_sent ?? 0;

        await this.supabase
          .from("prospects")
          .update({
            last_contacted_at: sentAt,
            total_emails_sent: currentCount + 1,
          })
          .eq("id", send.prospect_id);

        // Update domain total_sent
        if (send.sending_domain_id) {
          const { data: domainCountRow } = await this.supabase
            .from("sending_domains")
            .select("total_sent")
            .eq("id", send.sending_domain_id)
            .single();

          const domainTotal =
            (domainCountRow as { total_sent: number } | null)?.total_sent ?? 0;

          await this.supabase
            .from("sending_domains")
            .update({ total_sent: domainTotal + 1, updated_at: sentAt })
            .eq("id", send.sending_domain_id);
        }

        result.sent++;

        // Human-like delay: 15-45 seconds (simulated via scheduled_for offset for next item)
        // In a real worker we'd await a delay here; in serverless we skip to avoid timeout.
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        await this.supabase
          .from("sales_sends")
          .update({ status: "failed", error_message: msg.slice(0, 500) })
          .eq("id", send.id);
        result.failed++;
      }
    }

    return result;
  }

  /**
   * After a step's send completes, schedule the next step in the sequence
   * (if any) for the same prospect, `delay_days` after this send. No-op if
   * this was the last configured step, if the next step is already scheduled
   * for this prospect (idempotent against re-processing), or if the prospect
   * has since been suppressed.
   */
  private async scheduleNextStep(send: SendRow, sentAtIso: string): Promise<void> {
    const { data: steps } = await this.supabase
      .from("sales_campaign_steps")
      .select("*")
      .eq("campaign_id", send.campaign_id)
      .order("step_number", { ascending: true });

    const stepList = (steps ?? []) as Array<{
      id: string;
      step_number: number;
      subject_template: string;
      body_template: string;
      delay_days: number;
    }>;
    if (stepList.length === 0) return;

    const currentIdx = stepList.findIndex((s) => s.id === send.step_id);
    if (currentIdx === -1 || currentIdx + 1 >= stepList.length) return;

    const nextStep = stepList[currentIdx + 1];
    if (!nextStep) return;

    // Idempotency guard: don't double-schedule if a send for this step
    // already exists for this prospect (e.g. re-run after a partial failure).
    const { data: existing } = await this.supabase
      .from("sales_sends")
      .select("id")
      .eq("campaign_id", send.campaign_id)
      .eq("prospect_id", send.prospect_id)
      .eq("step_id", nextStep.id)
      .maybeSingle();
    if (existing) return;

    const { data: prospectData } = await this.supabase
      .from("prospects")
      .select("org_name, email, city, state, suppressed")
      .eq("id", send.prospect_id)
      .maybeSingle();
    const prospect = prospectData as {
      org_name: string;
      email: string | null;
      city: string | null;
      state: string | null;
      suppressed: boolean | null;
    } | null;
    if (!prospect || !prospect.email || prospect.suppressed) return;

    const vars: Record<string, string> = {
      org_name: prospect.org_name,
      first_name: getFirstName(prospect.org_name),
      city: prospect.city ?? "",
      state: prospect.state ?? "",
    };

    const { error } = await this.supabase.from("sales_sends").insert({
      campaign_id: send.campaign_id,
      step_id: nextStep.id,
      prospect_id: send.prospect_id,
      sending_domain_id: send.sending_domain_id,
      from_address: send.from_address,
      to_address: send.to_address,
      subject: renderTemplate(nextStep.subject_template, vars),
      body_html: renderTemplate(nextStep.body_template, vars),
      status: "queued",
      scheduled_for: addDaysIso(sentAtIso, nextStep.delay_days),
    });

    if (error) {
      throw new Error(`Failed to schedule step ${nextStep.step_number}: ${error.message}`);
    }
  }
}
