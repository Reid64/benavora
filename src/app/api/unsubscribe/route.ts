import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmailComplianceEngine } from "@/lib/admin/compliance";

const compliance = new EmailComplianceEngine();

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { searchParams } = new URL(req.url);
  const email = searchParams.get("email") ?? "";
  const token = searchParams.get("token") ?? "";

  if (!email || !token) {
    return new NextResponse(
      `<!DOCTYPE html><html><body><p>Invalid unsubscribe link.</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  if (!compliance.verifyUnsubscribeToken(email, token)) {
    return new NextResponse(
      `<!DOCTYPE html><html><body><p>Invalid or expired unsubscribe link.</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Unsubscribe</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;">
  <h2>Unsubscribe</h2>
  <p>Are you sure you want to unsubscribe <strong>${escapeHtml(email)}</strong> from all future emails?</p>
  <form method="POST" action="/api/unsubscribe">
    <input type="hidden" name="email" value="${escapeHtml(email)}" />
    <input type="hidden" name="token" value="${escapeHtml(token)}" />
    <button type="submit" style="background:#ef4444;color:#fff;border:none;padding:10px 24px;border-radius:6px;cursor:pointer;font-size:16px;">
      Yes, unsubscribe me
    </button>
  </form>
  <p style="margin-top:16px;"><a href="https://benavora.com">Return to Benavora</a></p>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let email: string;
  let token: string;

  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json()) as { email?: string; token?: string };
    email = body.email ?? "";
    token = body.token ?? "";
  } else {
    const formData = await req.formData();
    email = (formData.get("email") as string | null) ?? "";
    token = (formData.get("token") as string | null) ?? "";
  }

  if (!email || !token) {
    return new NextResponse(
      `<!DOCTYPE html><html><body><p>Missing email or token.</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  if (!compliance.verifyUnsubscribeToken(email, token)) {
    return new NextResponse(
      `<!DOCTYPE html><html><body><p>Invalid or expired unsubscribe token.</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  const supabase = createAdminClient();

  // Add to suppression list (upsert to avoid duplicates)
  const { error } = await supabase
    .from("suppression_list")
    .upsert({ email: email.toLowerCase(), reason: "unsubscribe" }, { onConflict: "email" });

  if (error) {
    return new NextResponse(
      `<!DOCTYPE html><html><body><p>Failed to process unsubscribe. Please try again.</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }

  // Also mark prospect as suppressed if they exist
  await supabase
    .from("prospects")
    .update({ suppressed: true })
    .eq("email", email.toLowerCase());

  const html = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Unsubscribed</title></head>
<body style="font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;">
  <h2>You've been unsubscribed</h2>
  <p><strong>${escapeHtml(email)}</strong> has been removed from our mailing list.</p>
  <p>You will no longer receive emails from Benavora.</p>
  <p style="margin-top:16px;"><a href="https://benavora.com">Return to Benavora</a></p>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html" },
  });
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}
