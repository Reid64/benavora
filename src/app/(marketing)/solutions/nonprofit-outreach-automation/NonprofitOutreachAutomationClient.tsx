"use client";

import Image from "next/image";
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

const CHANNELS: { label: string; body: string }[] = [
  {
    label: "Email",
    body: "Sequenced outreach to donor and corporate-giving prospects, sent through the platform, checked against the suppression list before every send.",
  },
  {
    label: "LinkedIn",
    body: "A personalized message is drafted by Claude from the contact's own record. There is no automated LinkedIn API call — the draft becomes a task on the contact for a person to send from their own account.",
  },
  {
    label: "Phone",
    body: "A call script is drafted the same way. Nothing dials automatically; the draft becomes a call task with the talking points a person actually uses on the call.",
  },
  {
    label: "Physical mail",
    body: "A personalized letter is drafted and attached to a mail task. Nothing prints, stamps, or mails itself — a person places it.",
  },
];

const FAQ_ITEMS: { question: string; answer: string }[] = [
  {
    question: "Does this send LinkedIn messages or make calls on its own?",
    answer:
      "No. LinkedIn, phone, and physical-mail outreach each generate a real, personalized draft from Claude, then log a task on the contact's record — a person sends the message, places the call, or mails the letter. There is no automated LinkedIn API call, no automated dialing, and no automated mail submission, by design, not as a rate-limited fallback.",
  },
  {
    question: "What actually is automated, then?",
    answer:
      "Drafting the personalized content for every channel, sequencing when each touch is due, checking every recipient against your suppression list before a send or a task is created, and tracking engagement back onto the contact record. Email sending itself goes out through the platform; every other channel stops at a drafted, ready-to-use asset.",
  },
  {
    question: "How does it avoid re-contacting someone who unsubscribed?",
    answer:
      "Every send and every generated task checks the organization's suppression list first. An unsubscribe agent processes opt-out signals and adds contacts to that list, and the check runs before the message goes out or the task is created, not after.",
  },
  {
    question: "Is the prospect list shared across organizations, or is it ours?",
    answer:
      "Corporate-giving prospect records are a shared directory — the same company profile isn't rebuilt from scratch by every organization that researches it. Your campaigns, sequences, suppression list, and contact tasks are scoped to your organization only.",
  },
  {
    question: "Is this the same thing as AutoApply?",
    answer:
      "No. AutoApply fills and submits funder application portals. This is relationship-building outreach to donor and corporate-giving prospects before there's an application to fill out — a different stage of the funding cycle with a different automation boundary.",
  },
];

export default function NonprofitOutreachAutomationClient() {
  return (
    <>
      <Section tone="forest">
        <Eyebrow>Solutions / Nonprofit Outreach Automation</Eyebrow>
        <Display1 tone="forest">Draft the outreach. Send the channels a platform can actually send.</Display1>
        <p style={{ color: mk.heroMuted, fontSize: 18, marginTop: 16, maxWidth: 700, lineHeight: 1.6 }}>
          Donor and corporate-giving cultivation means the same personalized message written four different
          ways for email, LinkedIn, a phone call, and a mailed letter — and most of those channels can&rsquo;t
          be safely automated without breaking a platform&rsquo;s terms of service. This runs the drafting and
          sequencing work across all four, sends the one channel it safely can, and hands the rest to a
          person as a ready-to-use task instead of pretending they don&rsquo;t exist.
        </p>
        <div style={{ display: "flex", gap: 16, marginTop: 28, flexWrap: "wrap" }}>
          <CtaPrimary href="/demo">See a real outreach sequence</CtaPrimary>
          <CtaGhost href="#channels" onDark>
            See the four channels
          </CtaGhost>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>The actual donor and corporate-giving directory</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Not a mockup — the live prospect directory, captured from a running instance of the application.
        </p>
        <div
          style={{
            marginTop: 24,
            borderRadius: mkRadius.shot,
            overflow: "hidden",
            border: `1px solid ${mk.line}`,
            boxShadow: "0 12px 32px rgba(31,58,46,0.14)",
          }}
        >
          <Image
            src="/marketing/platform-donor-discovery-live.png"
            alt="The live donor and corporate-giving prospect directory"
            width={1440}
            height={900}
            priority
            style={{ width: "100%", height: "auto", display: "block" }}
          />
        </div>
      </Section>

      <Section tone="paper" id="channels">
        <Display2>Four channels, one honest automation boundary</Display2>
        <p style={{ color: mk.ink, fontSize: 15, marginTop: 12, maxWidth: 680 }}>
          Every channel gets a personalized draft. Only one of them gets sent without a person touching it.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 20, marginTop: 24 }}>
          {CHANNELS.map((c) => (
            <Card key={c.label}>
              <div style={{ fontSize: 15, fontWeight: 700, color: mk.forest }}>{c.label}</div>
              <div style={{ fontSize: 14, color: mk.ink, marginTop: 8, lineHeight: 1.6 }}>{c.body}</div>
            </Card>
          ))}
        </div>
      </Section>

      <Section tone="surface">
        <Display2>Why LinkedIn, phone, and mail stop at a draft</Display2>
        <div style={{ maxWidth: 760 }}>
          <p style={{ color: mk.ink, fontSize: 16, lineHeight: 1.7 }}>
            An automated LinkedIn message sent through an unofficial API, an autodialer placing calls, or a
            mail-merge that prints and stamps itself are all real products in this category — and all three
            risk the channel&rsquo;s own terms of service or telemarketing regulation in ways that land on the
            nonprofit, not the vendor. The build here logs a real task on the contact&rsquo;s record instead,
            carrying the drafted content, so the person who sends it is making an informed decision to send
            it, not approving a black box.
          </p>
        </div>
      </Section>

      <Section tone="tint">
        <Display2>Stated limitations</Display2>
        <div style={{ display: "grid", gap: 16, marginTop: 24, maxWidth: 760 }}>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Three of the four channels require a person to actually act on the task &mdash; send the
              LinkedIn message, make the call, mail the letter. The platform does not track whether that
              action happened outside of marking the task complete; it isn&rsquo;t reading your LinkedIn
              inbox or your call log.
            </p>
          </Card>
          <Card>
            <p style={{ color: mk.ink, fontSize: 15, lineHeight: 1.7, margin: 0 }}>
              Corporate-giving prospect records are shared across organizations by design, so the underlying
              company profile can be edited by research runs triggered by other organizations. Your
              campaigns, sequences, and contact tasks are never shared.
            </p>
          </Card>
        </div>
      </Section>

      <Section tone="paper">
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
              FREE, NO ACCOUNT REQUIRED
            </div>
            <div style={{ fontFamily: "var(--mk-display)", fontSize: 24, color: mk.forest, marginTop: 8 }}>
              Not ready to build a prospect list yet?
            </div>
            <p style={{ fontSize: 15, color: mk.ink, marginTop: 8 }}>
              Run the free Funding Potential Scan first to see the kind of funding your organization is
              likely to qualify for, no signup required.
            </p>
          </div>
          <CtaPrimary href="/scan">Try the free Funding Potential Scan</CtaPrimary>
        </div>
      </Section>

      <Section tone="forest">
        <div style={{ textAlign: "center" }}>
          <Display2 tone="forest">Draft every channel. Send the ones you actually can.</Display2>
          <p style={{ color: mk.heroMuted, fontSize: 17, marginTop: 16, maxWidth: 560, marginLeft: "auto", marginRight: "auto" }}>
            See a real donor and corporate-giving sequence run across email, LinkedIn, phone, and mail.
          </p>
          <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 28, flexWrap: "wrap" }}>
            <CtaPrimary href="/demo">See a real outreach sequence</CtaPrimary>
            <CtaGhost href="/pricing" onDark>
              See pricing
            </CtaGhost>
          </div>
        </div>
      </Section>
    </>
  );
}
