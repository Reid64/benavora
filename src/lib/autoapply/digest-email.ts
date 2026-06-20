import { Resend } from "resend";

export interface SendAutoapplyDigestParams {
  organizationId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any;
  since: Date;
}

interface SubmissionRow {
  id: string;
  status: string;
  confirmation_number: string | null;
  error_message: string | null;
  funder_name: string | null;
}

const FAILURE_ACTIONS: Record<string, string> = {
  captcha_blocked: "Retry manually or configure a CAPTCHA-solving service.",
  account_required: "Create a portal account and store credentials in Settings.",
  site_error: "Will be auto-retried. Check the AutoApply dashboard for details.",
  form_changed: "Form template will be re-analyzed on next run.",
};

function failureAction(errorMessage: string | null): string {
  if (!errorMessage) return "Review in the AutoApply dashboard.";
  for (const [key, action] of Object.entries(FAILURE_ACTIONS)) {
    if (errorMessage.toLowerCase().includes(key.replace("_", " ")) || errorMessage.toLowerCase().includes(key)) {
      return action;
    }
  }
  return "Review in the AutoApply dashboard.";
}

function buildHtml(params: {
  date: string;
  completed: SubmissionRow[];
  failed: SubmissionRow[];
  queueRemaining: number;
  appUrl: string;
}): { subject: string; html: string } {
  const { date, completed, failed, queueRemaining, appUrl } = params;

  const subject = `Benavora AutoApply Results — ${date}`;

  const completedRows = completed
    .map((s) => {
      const name = s.funder_name ?? "Unknown funder";
      const conf = s.confirmation_number ? ` (Confirmation: ${s.confirmation_number})` : "";
      return `<li style="margin-bottom:4px">${name}${conf}</li>`;
    })
    .join("\n");

  const failedRows = failed
    .map((s) => {
      const name = s.funder_name ?? "Unknown funder";
      const action = failureAction(s.error_message);
      return `<li style="margin-bottom:6px"><strong>${name}</strong><br><span style="color:#6b7280;font-size:13px">${s.error_message ?? "Unknown error"}</span><br><span style="color:#1d4ed8;font-size:13px">Action: ${action}</span></li>`;
    })
    .join("\n");

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="font-family:sans-serif;color:#111827;max-width:600px;margin:0 auto;padding:24px">

  <h2 style="margin-top:0">AutoApply Results — ${date}</h2>

  <p style="font-size:16px;background:#f3f4f6;padding:12px 16px;border-radius:6px;margin-bottom:24px">
    <strong>${completed.length}</strong> submission${completed.length !== 1 ? "s" : ""} completed &nbsp;|&nbsp;
    <strong>${failed.length}</strong> failed &nbsp;|&nbsp;
    <strong>${queueRemaining}</strong> remaining in queue
  </p>

  ${
    completed.length > 0
      ? `<h3 style="color:#059669">✓ Completed (${completed.length})</h3>
  <ul style="padding-left:20px;margin-bottom:24px">
    ${completedRows}
  </ul>`
      : `<p style="color:#6b7280">No completed submissions in this period.</p>`
  }

  ${
    failed.length > 0
      ? `<h3 style="color:#dc2626">✗ Failed (${failed.length})</h3>
  <ul style="padding-left:20px;margin-bottom:24px;list-style:none;padding-left:0">
    ${failedRows}
  </ul>`
      : ""
  }

  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0">

  <p style="font-size:14px;color:#6b7280">
    <a href="${appUrl}/autoapply" style="color:#1d4ed8">View full details in the AutoApply dashboard →</a>
  </p>

</body>
</html>`.trim();

  return { subject, html };
}

export async function sendAutoapplyDigest({
  organizationId,
  supabase,
  since,
}: SendAutoapplyDigestParams): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.warn("sendAutoapplyDigest: RESEND_API_KEY not set — skipping digest email.");
    return;
  }

  // Fetch submissions since `since` for this org, joining funders for names.
  const { data: submissions, error: subError } = await supabase
    .from("autoapply_submissions")
    .select("id, status, confirmation_number, error_message, funders(name)")
    .eq("organization_id", organizationId)
    .gte("created_at", since.toISOString());

  if (subError) {
    console.warn(`sendAutoapplyDigest: could not fetch submissions — ${subError.message}`);
    return;
  }

  const rows: SubmissionRow[] = (submissions ?? []).map(
    (s: { id: string; status: string; confirmation_number: string | null; error_message: string | null; funders: { name: string } | null }) => ({
      id: s.id,
      status: s.status,
      confirmation_number: s.confirmation_number,
      error_message: s.error_message,
      funder_name: s.funders?.name ?? null,
    })
  );

  const completed = rows.filter((r) => r.status === "submitted");
  const failed = rows.filter((r) =>
    ["failed", "captcha_blocked", "account_required", "site_error"].includes(r.status)
  );

  // Count pending items remaining in queue for this org.
  const { count: queueCount } = await supabase
    .from("submission_queue")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .eq("status", "pending");

  const queueRemaining = queueCount ?? 0;

  // Get admin/owner email from profiles.
  const { data: admins } = await supabase
    .from("profiles")
    .select("email")
    .eq("organization_id", organizationId)
    .in("role", ["owner", "admin"])
    .limit(5);

  const emailList: string[] = (admins ?? []).map((p: { email: string }) => p.email).filter(Boolean);
  if (emailList.length === 0) {
    console.warn(`sendAutoapplyDigest: no admin/owner email found for org ${organizationId} — skipping.`);
    return;
  }

  const date = since.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "https://benavora.com";

  const { subject, html } = buildHtml({ date, completed, failed, queueRemaining, appUrl });

  try {
    const resend = new Resend(resendKey);
    await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL ?? "notifications@benavora.com",
      to: emailList,
      subject,
      html,
    });
  } catch (err) {
    console.warn(`sendAutoapplyDigest: Resend send failed — ${err instanceof Error ? err.message : String(err)}`);
  }
}
