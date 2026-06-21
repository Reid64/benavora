import "server-only";
import { Resend } from "resend";

import { createAdminClient } from "@/lib/supabase/admin";
import { EmailTemplateEngine } from "@/lib/email/template-engine";

export interface SequenceStepConfig {
  template_id?: string;
  subject_override?: string;
  body_override?: string;
  delay_days: number;
  delay_hours?: number;
  condition_type?: string;
}

export interface SequenceConfig {
  name: string;
  description?: string;
  steps: SequenceStepConfig[];
}

const MAX_SENDS_PER_RUN = 50;
const templateEngine = new EmailTemplateEngine();

function getResend(): Resend {
  const key = process.env.RESEND_API_KEY;
  if (!key) throw new Error("RESEND_API_KEY is not configured");
  return new Resend(key);
}

function addDelayToNow(delayDays: number, delayHours: number): string {
  const ms = (delayDays * 24 * 60 + delayHours * 60) * 60 * 1000;
  return new Date(Date.now() + ms).toISOString();
}

export class SequenceEngine {
  async createSequence(orgId: string, config: SequenceConfig): Promise<string> {
    const admin = createAdminClient();

    const { data: seq, error: seqErr } = await admin
      .from("email_campaign_sequences")
      .insert({
        organization_id: orgId,
        name: config.name,
        description: config.description ?? null,
        trigger_type: "manual",
        status: "active",
      })
      .select("id")
      .single();

    if (seqErr || !seq) throw new Error(seqErr?.message ?? "Failed to create sequence");

    if (config.steps.length > 0) {
      const steps = config.steps.map((step, i) => ({
        sequence_id: seq.id,
        step_number: i + 1,
        template_id: step.template_id ?? null,
        subject_override: step.subject_override ?? null,
        body_override: step.body_override ?? null,
        delay_days: step.delay_days,
        delay_hours: step.delay_hours ?? 0,
        condition_type: step.condition_type ?? "always",
      }));

      const { error: stepsErr } = await admin.from("email_sequence_steps").insert(steps);
      if (stepsErr) throw new Error(stepsErr.message);
    }

    return seq.id;
  }

  async enrollContact(
    sequenceId: string,
    enrollment: {
      email: string;
      contact_id?: string;
      funder_id?: string;
      variables: Record<string, string>;
    },
  ): Promise<void> {
    const admin = createAdminClient();

    const { data: seq, error: seqErr } = await admin
      .from("email_campaign_sequences")
      .select("id, organization_id")
      .eq("id", sequenceId)
      .single();

    if (seqErr || !seq) throw new Error("Sequence not found");

    const { data: firstStep } = await admin
      .from("email_sequence_steps")
      .select("delay_days, delay_hours")
      .eq("sequence_id", sequenceId)
      .order("step_number", { ascending: true })
      .limit(1)
      .maybeSingle();

    const nextSendAt = addDelayToNow(
      firstStep?.delay_days ?? 0,
      firstStep?.delay_hours ?? 0,
    );

    const { error: insertErr } = await admin.from("email_sequence_enrollments").insert({
      organization_id: seq.organization_id,
      sequence_id: sequenceId,
      contact_id: enrollment.contact_id ?? null,
      funder_id: enrollment.funder_id ?? null,
      email_address: enrollment.email,
      current_step: 0,
      status: "active",
      next_send_at: nextSendAt,
      variables: enrollment.variables,
    });

    // 23505 = unique_violation — already enrolled, treat as success
    const pgErr = insertErr as { code?: string } | null;
    if (pgErr && pgErr.code !== "23505") {
      throw new Error(insertErr?.message ?? "Failed to enroll contact");
    }
  }

  async processScheduledSends(): Promise<{ sent: number; failed: number; skipped: number }> {
    const admin = createAdminClient();
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    const { data: enrollments, error } = await admin
      .from("email_sequence_enrollments")
      .select("*")
      .eq("status", "active")
      .lte("next_send_at", new Date().toISOString())
      .limit(MAX_SENDS_PER_RUN);

    if (error) throw new Error(error.message);
    if (!enrollments?.length) return { sent, failed, skipped };

    const resend = getResend();
    const fromEmail = process.env.RESEND_FROM_EMAIL ?? "outreach@benavora.com";

    for (const enrollment of enrollments) {
      const nextStepNumber = (enrollment.current_step ?? 0) + 1;

      const { data: step } = await admin
        .from("email_sequence_steps")
        .select("step_number, subject_override, body_override, delay_days, delay_hours, template_id")
        .eq("sequence_id", enrollment.sequence_id)
        .eq("step_number", nextStepNumber)
        .maybeSingle();

      if (!step) {
        await admin
          .from("email_sequence_enrollments")
          .update({ status: "completed", completed_at: new Date().toISOString() })
          .eq("id", enrollment.id);
        skipped++;
        continue;
      }

      // Fetch the linked template separately to avoid join type complexity
      let tpl: { subject: string; body: string } | null = null;
      if (step.template_id) {
        const { data: tmpl } = await admin
          .from("email_templates")
          .select("subject, body")
          .eq("id", step.template_id)
          .maybeSingle();
        if (tmpl) tpl = { subject: tmpl.subject, body: tmpl.body };
      }

      try {
        const rawSubject = step.subject_override ?? tpl?.subject ?? "";
        const rawBody = step.body_override ?? tpl?.body ?? "";

        if (!rawSubject || !rawBody) {
          skipped++;
          continue;
        }

        const vars = (enrollment.variables as Record<string, string> | null) ?? {};
        const rendered = templateEngine.renderTemplate(
          { subject: rawSubject, body: rawBody },
          vars,
        );

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: sendErr } = await (resend.emails.send as (p: any) => Promise<{ data: unknown; error: { message: string } | null }>)({
          from: fromEmail,
          to: enrollment.email_address,
          subject: rendered.subject,
          html: rendered.body,
        });

        if (sendErr) throw new Error(sendErr.message);

        // Determine whether there is a subsequent step
        const { data: nextStep } = await admin
          .from("email_sequence_steps")
          .select("delay_days, delay_hours")
          .eq("sequence_id", enrollment.sequence_id)
          .eq("step_number", nextStepNumber + 1)
          .maybeSingle();

        const now = new Date().toISOString();

        if (!nextStep) {
          await admin
            .from("email_sequence_enrollments")
            .update({
              current_step: nextStepNumber,
              status: "completed",
              completed_at: now,
              last_sent_at: now,
            })
            .eq("id", enrollment.id);
        } else {
          await admin
            .from("email_sequence_enrollments")
            .update({
              current_step: nextStepNumber,
              last_sent_at: now,
              next_send_at: addDelayToNow(nextStep.delay_days ?? 0, nextStep.delay_hours ?? 0),
            })
            .eq("id", enrollment.id);
        }

        sent++;
      } catch {
        failed++;
      }
    }

    return { sent, failed, skipped };
  }

  // Called by the Gmail sync engine when new messages arrive on a tracked thread.
  // If a reply is detected the enrollment is paused so no further steps are sent.
  async detectReply(threadId: string, enrollmentId: string): Promise<boolean> {
    const admin = createAdminClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { count } = await (admin as any)
      .from("synced_email_messages")
      .select("id", { count: "exact", head: true })
      .eq("thread_id", threadId);

    const hasReply = (count ?? 0) > 1;

    if (hasReply) {
      await admin
        .from("email_sequence_enrollments")
        .update({
          reply_detected: true,
          status: "paused",
          paused_at: new Date().toISOString(),
        })
        .eq("id", enrollmentId);
    }

    return hasReply;
  }
}

export const sequenceEngine = new SequenceEngine();
