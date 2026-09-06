"use client";

import { Section, Display1, Display2 } from "@/components/marketing/Section";
import { CtaPrimary, CtaGhost } from "@/components/marketing/Cta";
import { mk, mkRadius } from "@/lib/marketing/theme";

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, color: mk.heroMuted, letterSpacing: 0.6, marginBottom: 12 }}>
      {children}
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: mk.surface, border: `1px solid ${mk.line}`, borderRadius: mkRadius.card, padding: 20 }}>
      {children}
    </div>
  );
}

const GATES: { label: string; body: string }[] = [
  {
    label: "Risk-based routing before AutoApply submits",
    body: "Ten weighted factors — a manual-only portal flag, a legal attestation checkbox, an ask amount well above the funder's historical maximum, missing required documents, an unanalyzed form, and others — produce a 0-100 score. Anything scoring above 50 (\"high\" or \"critical\") is routed to a manual queue before a browser session ever opens, and a notification fires for that same band. It is never submitted automatically.",
  },
  {
    label: "CAPTCHA and verification pauses",
    body: "The platform does not solve CAPTCHAs or identity-verification challenges. Detecting reCAPTCHA, hCaptcha, Turnstile, or a page containing a phrase like \"verify you're human\" stops the run immediately, captures a screenshot, and waits for a person to resolve it and resume — nothing here is auto-bypassed.",
  },
  {
    label: "Draft approval is always a human click",
    body: "A draft's only forward action in the wizard is Save, which writes it onto a pipeline item, not a submission. Moving a draft into AutoApply requires a person to click Approve or Submit in the Draft Queue — there is no code path that approves a draft automatically. An organization can set a confidence threshold so an approved draft above it skips a second, separate Submit click, but Approve itself is never something the system does on its own.",
  },
  {
    label: "Agent-authored drafts are structurally blocked from submitting",
    body: "An agent can generate a full draft with no person writing it, when an organization has opted into that. The code path that creates those drafts fails outright unless it marks the row pending review, and it never sets a submission timestamp — the review screen for those drafts can only dismiss one from the queue, never submit it.",
  },
  {
    label: "Non-email outreach stops at a drafted task, not a send",
    body: "LinkedIn messages, call scripts, and physical-mail letters are drafted by Claude from a contact's own record, then logged as a task for a person to send, place, or mail. There is no automated LinkedIn API call, no automated dialing, and no automated mail submission.",
  },
];

const AUTONOMY_ROWS: { label: string; body: string }[] = [
  { label: "Opportunity Discovery", body: "auto_research_enabled — off by default" },
  { label: "Probability Scoring", body: "auto_score_enabled — off by default" },
  { label: "Draft Generation", body: "auto_draft_enabled — off by default, plus a confidence threshold (50–95, default 70) below which no draft is even generated unsupervised" },
  { label: "Funder & Contact Monitoring", body: "auto_reputation_enabled — off by default" },
  { label: "Relationship Builder", body: "auto_relationship_enabled — off by default" },
  { label: "Deadline Prediction", body: "auto_deadline_prediction_enabled — off by default" },
  { label: "Follow-Up Scheduling", body: "auto_followup_enabled — off by default" },
  { label: "AutoApply", body: "auto_autoapply_enabled — off by default, bounded by a nightly submission cap (10–400, default 50) even once on" },
  { label: "Disaster Response Auto-Deploy", body: "auto_deploy_disaster_response — off by default; deploying a live outreach campaign unsupervised is treated as its own explicit opt-in, separate from every other toggle" },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Is \"human-in-the-loop\" a marketing phrase here, or is it actually enforced in code?",
    answer:
      "It's enforced at specific, separately-gated points: a risk score above 50 routes to a manual queue before a browser session opens; a CAPTCHA or verification challenge pauses the run and waits for a person; a draft can only reach AutoApply through a person clicking Approve or Submit; and an agent-authored draft is structurally prevented from ever setting a submission timestamp. None of these are settings that can be silently disabled from the outside — they run on every item, every time.",
  },
  {
    question: "Can we turn on full autonomy and let it run unattended?",
    answer:
      "Nine autonomy toggles exist, one per capability (research, scoring, drafting, funder monitoring, relationship building, deadline prediction, follow-up scheduling, AutoApply itself, and disaster-response outreach), and every one of them defaults to off for every organization. Only an owner or admin can turn any of them on. Turning on drafting or AutoApply doesn't remove the approval gates above it — it only lets the earlier stages run without someone manually starting each one.",
  },
  {
    question: "If an agent makes a decision on its own, is there a record of it?",
    answer:
      "Yes. Every autonomous decision is written to an audit trail with the agent that made it, its reasoning, its confidence score, the action it took, and a required_human_review flag. Where a person has reviewed a flagged decision, that reviewer's identity, the time, and their verdict are recorded on the same row.",
  },
  {
    question: "Who can actually stop automated submission if something looks wrong?",
    answer:
      "Four independent pause switches exist — platform-wide, a specific domain, a specific funder, or a single organization — and every one of them is checked before an item runs, ahead of the risk engine and the CAPTCHA check. An admin doesn't need to disable a whole organization's account to stop one funder or one domain.",
  },
  {
    question: "Does this page apply to every feature on the platform, or just AutoApply?",
    answer:
      "This describes the gates in AutoApply, Draft Generator, and non-email outreach specifically, since those are the surfaces where an AI-produced output could otherwise reach a funder, a donor, or a contact without review. Research and scoring stages produce a feed or a ranked list for a person to act on either way, whether or not their own autonomy toggle is on.",
  },
];

export default function HumanInTheLoopAiClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Human-in-the-Loop AI</Eyebrow>
        <Display1 tone="forest">Where the automation actually stops, in the code, not in a claim.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 700, lineHeight: 1.6 }}>
          &ldquo;A person is always in the loop&rdquo; is an easy thing for any vendor to say. This page names
          the specific gates instead: the risk score that has to clear before AutoApply opens a browser
          session, the confidence threshold a draft has to clear before it can even be generated unsupervised,
          the click that always has to happen before a draft reaches a funder, and the audit row written every
          time an agent makes a decision on its own.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">Walk through a real approval gate</CtaPrimary>
          <CtaGhost href="#gates" onDark>
            See the five gates
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint" id="gates">
        <Display2>Five places a person, not the model, decides</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 800 }}>
          {GATES.map((g) => (
            <Card key={g.label}>
              <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{g.label}</div>
              <div style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.7 }}>{g.body}</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="paper">
        <Display2>The actual autonomy configuration, one toggle per capability</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 700 }}>
          This is the real per-organization configuration schema, not an illustration — nine independent
          settings, every one off until an owner or admin turns it on. A writer or viewer account cannot
          change any of them.
        </p>
        <div style={{ marginTop: 24, display: "grid", gap: 1, background: mk.line, borderRadius: mkRadius.card, overflow: "hidden" }}>
          {AUTONOMY_ROWS.map((r) => (
            <div
              key={r.label}
              style={{
                display: "flex",
                flexWrap: "wrap",
                justifyContent: "space-between",
                gap: 12,
                background: mk.surface,
                padding: "16px 20px",
              }}
            >
              <span style={{ color: mk.forest, fontSize: 15, fontWeight: 600, minWidth: 220 }}>{r.label}</span>
              <span style={{ color: mk.ink, fontSize: 14, fontFamily: "monospace" }}>{r.body}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>Every autonomous decision gets a row a person can review</Display2>
        <div style={{ maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            When any of the toggles above is on and an agent acts without a person driving it in that moment,
            the decision is written to an audit trail: which agent made it, what it decided, its reasoning,
            its confidence score, the action actually taken, and whether that decision is flagged as requiring
            human review. A flagged row carries the reviewing person&rsquo;s identity, the time they reviewed
            it, and their verdict — an actual record, not a log line nobody reads.
          </p>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Four independent pause switches</Display2>
        <div style={{ maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            Above every other check, automated submission can be halted at four levels — platform-wide, a
            specific domain, a specific funder, or a single organization — and each one is checked before an
            item runs. Stopping one funder&rsquo;s submissions doesn&rsquo;t require pausing the whole
            platform, and a problem traced to one organization doesn&rsquo;t require touching anyone else&rsquo;s
            queue.
          </p>
        </div>
      </Section>

      <Section tone="paper">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              An agent-authored draft still gets created and stored even though it&rsquo;s structurally
              blocked from submission — a reviewer still has to actually open the Draft Queue and act on it.
              Turning on the drafting toggle produces more items in a review queue, not fewer things for a
              person to look at.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              The non-email outreach tasks (LinkedIn, phone, mail) track whether a person marked the task
              complete, not whether the message was actually sent, the call actually placed, or the letter
              actually mailed outside the platform.
            </p>
          </Card>
        </div>
      </Section>

      <Section tone="surface">
        <Display2>FAQ</Display2>
        <div style={{ marginTop: 24, display: "grid", gap: 18, maxWidth: 760 }}>
          {FAQ_ITEMS.map((f) => (
            <div key={f.question}>
              <div style={{ fontSize: 16, fontWeight: 600, color: mk.forest }}>{f.question}</div>
              <div style={{ fontSize: 15, color: mk.ink, marginTop: 6, lineHeight: 1.6 }}>{f.answer}</div>
            </div>
          ))}
        </div>
      </Section>

      <Section tone="tint">
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 20,
            background: mk.surface,
            border: `1px solid ${mk.line}`,
            borderRadius: mkRadius.shot,
            padding: 32,
          }}
        >
          <div style={{ maxWidth: 520 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: mk.terracotta, letterSpacing: 0.4 }}>
              READ THE FULL MODEL
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              This page covers the gates. Trust and Governance covers the rest.
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Security model, data handling, and the platform-wide governance page these gates feed into.
            </p>
          </div>
          <CtaGhost href="/trust">Read the Trust and Governance page</CtaGhost>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">See a real submission clear these gates</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            Watch the risk engine, the CAPTCHA check, and the approval click happen on a real application, not
            a diagram of them.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">Walk through a real approval gate</CtaPrimary>
            <CtaGhost href="/platform/autoapply" onDark>
              See the full AutoApply page
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
