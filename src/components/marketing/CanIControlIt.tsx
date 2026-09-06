import Link from "next/link";

// "Can I control it" — answers the automation-trust objection with AutoApply's
// real risk-gated control model, not a generic "human in the loop" claim.
// Same dark forest canvas as the surrounding homepage sections (bm- prefixed
// classes, #222624 background, #3b403b divider — see page.tsx bm-identity/
// bm-outcome, WillItUnderstandMyOrg.tsx, CanISeeIt.tsx).
//
// Every mechanism below is read from the real implementation, not invented:
// - src/lib/autoapply/risk-engine.ts: assessSubmissionRisk() scores 10 named
//   factors (manual_only_portal, captcha_in_template, requires_login,
//   missing_required_documents, ask_exceeds_historical_max, first_submission,
//   no_form_template/low_template_confidence, cross_client_collision,
//   legal_attestation_required, org_not_ready) into a 0-100 score, classifies
//   low/medium/high/critical, and only recommends 'manual' handling at
//   high/critical — 'auto'/'assisted' proceed without a human review-and-
//   approve step on the filled form.
// - worker/queue-processor.ts: recommendation==='manual' routes the item to
//   status='pending_manual' and fires a 'review_needed' webhook when
//   riskAssessment.shouldNotify (high/critical). CAPTCHA/verification-challenge
//   detection unconditionally pauses to status='paused_verification' with a
//   screenshot — CAPTCHA auto-solve was deliberately removed, human-in-the-
//   loop only (see CaptchaPauseError comments, ~L136-141). Missing portal
//   credentials route to 'requires_account_setup'.
// - src/lib/autoapply/queue-controls.ts + src/app/api/autoapply/controls/
//   route.ts: QueueControlPlane checks platform -> domain -> funder -> tenant
//   pause state before every item; POST/DELETE require 'admin' role for
//   control_type='platform', 'owner' role for tenant/funder/domain.
// - src/app/api/autoapply/review-queue/[id]/{resume,skip,reassign}/route.ts:
//   day-to-day handling of an already-paused item requires 'writer' role;
//   skip requires one of SKIP_REASONS = not_worth_it | portal_broken |
//   duplicate | other (src/app/api/autoapply/review-queue/[id]/skip/route.ts
//   L14), not a free-text dismissal. Resume/skip use a conditional
//   UPDATE...RETURNING RPC so two reviewers can't double-handle the same item
//   (409 already_handled on a race).
// - submission_queue columns risk_score, risk_factors (jsonb), pause_reason,
//   paused_at, paused_screenshot_path, paused_history (jsonb) persist why an
//   item stopped, not just that it did (AUTOAPPLY_RUNBOOK.md §1 table).
//
// NOTE: this deliberately does not repeat the "every submission stops for a
// staff member to approve, with no exceptions" framing used on /trust and
// /platform/autoapply — that claim does not match assessSubmissionRisk()'s
// 'auto'/'assisted' paths, which proceed without a human approving the final
// filled form. This component describes the real, narrower guarantee instead:
// specific triggers (CAPTCHA, high/critical risk, missing credentials) always
// stop for a person; routine low-risk submissions do not wait on one.
const CONTROLS: { mechanism: string; how: string; means: string }[] = [
  {
    mechanism: "Risk scoring on every submission",
    how: "Before AutoApply touches a portal, it scores the submission against ten factors — a portal flagged manual-only, a CAPTCHA field, missing required documents, an ask exceeding the funder's historical giving, a first-time funder relationship, a legal attestation checkbox, and more.",
    means: "Low-risk submissions proceed. Anything scored high or critical is routed to a manual queue instead of submitted automatically.",
  },
  {
    mechanism: "Hard stops that never proceed unattended",
    how: "CAPTCHA and identity-verification challenges always pause the run for a person — automatic CAPTCHA-solving was deliberately removed from the system. Portals that require a one-time account signup pause the same way.",
    means: "There is no override that lets automation push through a CAPTCHA or create a new portal account on its own.",
  },
  {
    mechanism: "Escalation, not a dashboard you have to remember to check",
    how: "When a submission is flagged high or critical risk, an alert fires automatically to notify staff — review doesn't depend on someone happening to look at the queue.",
    means: "Risky items surface themselves instead of waiting to be found.",
  },
  {
    mechanism: "Pause controls at four levels",
    how: "An organization owner can pause automation for one funder, one portal domain, or their whole organization at any time. Halting every organization's automation platform-wide requires an admin.",
    means: "Control over how much AutoApply is allowed to touch sits with a real, role-checked permission — not a toggle anyone can flip.",
  },
  {
    mechanism: "An audit trail on every stop",
    how: "Each paused item keeps the exact risk score and the specific factors that triggered it, plus a running history rather than an overwritten note. Skipping an item requires picking a real reason — not worth it, portal broken, duplicate, or other — not a silent dismissal.",
    means: "A reviewer sees why a submission stopped, not just that it did — and that record stays attached to the item.",
  },
];

export function CanIControlIt() {
  return (
    <section className="bm-control" aria-labelledby="control-title">
      <p className="bm-eyebrow">Can I control it?</p>
      <h2 id="control-title">
        It knows which decisions
        <br />
        aren&rsquo;t its to make.
      </h2>
      <p className="bm-control-lede">
        AutoApply doesn&rsquo;t run on a single on/off switch. Every submission is scored for risk first, specific
        triggers always stop for a person, and the controls over how far automation can go are role-checked, not
        a setting anyone can quietly change.
      </p>

      <ul className="bm-control-list">
        {CONTROLS.map((c) => (
          <li key={c.mechanism}>
            <span className="bm-mechanism">{c.mechanism}</span>
            <span className="bm-body">
              <span className="bm-how">{c.how}</span>
              <span className="bm-means">{c.means}</span>
            </span>
          </li>
        ))}
      </ul>

      <p className="bm-control-closer">
        Routine, low-risk submissions move without waiting on a person. The moment a submission looks unfamiliar,
        risky, or requires a judgment call the system isn&rsquo;t positioned to make, it stops — and leaves behind
        exactly why.
      </p>

      <div className="bm-cta-wrap">
        <Link
          href="/platform/autoapply"
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 12,
            borderRadius: 8,
            padding: "15px 25px",
            fontSize: 14,
            fontWeight: 600,
            color: "#f5f7f2",
            background: "#405b49",
            border: "1px solid #77927e",
            boxShadow: "0 4px 14px rgba(0, 0, 0, 0.125)",
            textDecoration: "none",
            transition: "background 0.2s, border-color 0.2s",
          }}
        >
          See how AutoApply works <span aria-hidden="true">&rarr;</span>
        </Link>
      </div>

      <style jsx>{`
        .bm-control {
          max-width: 1120px;
          margin: 0 auto;
          text-align: center;
          padding: 64px 32px 72px;
          background: #222624;
          border-top: 1px solid #3b403b;
        }
        .bm-eyebrow {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 0.02em;
          color: #b9cbbd;
        }
        .bm-control h2 {
          font-size: clamp(28px, 3vw, 38px);
          line-height: 1.25;
          letter-spacing: -0.02em;
          font-weight: 550;
          color: #f0f2ee;
          max-width: 820px;
          margin: 18px auto 0;
        }
        .bm-control-lede {
          color: #bdc4be;
          max-width: 680px;
          margin: 20px auto 0;
          font-size: 16px;
          line-height: 1.8;
        }
        .bm-control-list {
          list-style: none;
          margin: 40px auto 0;
          padding: 0;
          max-width: 860px;
          text-align: left;
          display: flex;
          flex-direction: column;
        }
        .bm-control-list li {
          display: flex;
          align-items: flex-start;
          gap: 24px;
          padding: 22px 0;
          border-top: 1px solid #3b403b;
        }
        .bm-control-list li:last-child {
          border-bottom: 1px solid #3b403b;
        }
        .bm-mechanism {
          flex: 0 0 auto;
          width: 190px;
          color: #efb344;
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.03em;
          text-transform: uppercase;
          padding-top: 2px;
        }
        .bm-body {
          flex: 1 1 auto;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .bm-how {
          color: #f2f5ef;
          font-size: 15px;
          line-height: 1.6;
        }
        .bm-means {
          color: #9aa39c;
          font-size: 14px;
          line-height: 1.6;
        }
        .bm-control-closer {
          color: #bdc4be;
          max-width: 720px;
          margin: 36px auto 0;
          font-size: 15px;
          line-height: 1.8;
        }
        .bm-cta-wrap {
          margin-top: 28px;
        }
        @media (max-width: 720px) {
          .bm-control {
            padding: 44px 24px 52px;
          }
          .bm-control-lede,
          .bm-control-closer {
            font-size: 15px;
          }
          .bm-control-list li {
            flex-direction: column;
            gap: 8px;
            padding: 18px 0;
          }
          .bm-mechanism {
            width: auto;
          }
        }
      `}</style>
    </section>
  );
}
