// Generates a PDF submission receipt, uploads it to Supabase Storage, and records
// it in the submission_receipts table. Called by the AutoApply worker after every
// successful form submission.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { ConfirmationData } from "./confirmation-parser.js";

type AutoApplySubmission =
  Database["public"]["Tables"]["autoapply_submissions"]["Row"];
type RequestProfile =
  Database["public"]["Tables"]["request_profiles"]["Row"];

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 50;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LH = 15;

const C_DARK_BLUE = rgb(0.05, 0.1, 0.35);
const C_WHITE = rgb(1, 1, 1);
const C_BLACK = rgb(0, 0, 0);
const C_GRAY = rgb(0.4, 0.4, 0.4);
const C_LIGHT_GRAY = rgb(0.75, 0.75, 0.75);
const C_DARK_GRAY = rgb(0.2, 0.2, 0.2);
const C_GREEN = rgb(0.08, 0.45, 0.18);
const C_HEADER_SUB = rgb(0.75, 0.75, 0.9);

function wrapText(
  text: string,
  maxW: number,
  font: { widthOfTextAtSize: (t: string, s: number) => number },
  size: number,
): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxW && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function capitalize(s: string): string {
  return s
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatCurrency(n: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(n);
}

export async function generateReceipt(params: {
  supabase: SupabaseClient;
  submission: AutoApplySubmission;
  funderName: string;
  orgName: string;
  requestProfile?: RequestProfile;
  confirmationData?: ConfirmationData;
  screenshots?: { stage: string; path: string }[];
}): Promise<Buffer> {
  const {
    supabase,
    submission,
    funderName,
    orgName,
    requestProfile,
    confirmationData,
    screenshots,
  } = params;

  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  let y = PAGE_H - MARGIN;

  const aboveFooter = (): boolean => y > 65;

  function drawHRule(): void {
    page.drawLine({
      start: { x: MARGIN, y },
      end: { x: PAGE_W - MARGIN, y },
      thickness: 0.5,
      color: C_LIGHT_GRAY,
    });
  }

  function drawText(
    content: string,
    opts: {
      x?: number;
      size?: number;
      useBold?: boolean;
      color?: ReturnType<typeof rgb>;
    } = {},
  ): void {
    page.drawText(content, {
      x: opts.x ?? MARGIN,
      y,
      size: opts.size ?? 9,
      font: opts.useBold ? bold : font,
      color: opts.color ?? C_BLACK,
    });
  }

  function field(
    label: string,
    value: string | null | undefined,
    valueColor?: ReturnType<typeof rgb>,
  ): void {
    if (value == null || value === "") return;
    drawText(label + ":", { useBold: true, color: C_GRAY });
    drawText(value, { x: MARGIN + 145, color: valueColor ?? C_BLACK });
    y -= LH;
  }

  function sectionHead(title: string): void {
    y -= 6;
    drawHRule();
    y -= 14;
    drawText(title, { useBold: true, size: 10, color: C_DARK_BLUE });
    y -= 16;
  }

  // ── Header ──────────────────────────────────────────────────────────────────
  page.drawRectangle({
    x: 0,
    y: PAGE_H - 85,
    width: PAGE_W,
    height: 85,
    color: C_DARK_BLUE,
  });
  page.drawText("SUBMISSION RECEIPT", {
    x: MARGIN,
    y: PAGE_H - 38,
    size: 20,
    font: bold,
    color: C_WHITE,
  });
  page.drawText(orgName, {
    x: MARGIN,
    y: PAGE_H - 57,
    size: 10,
    font: bold,
    color: C_WHITE,
  });
  page.drawText("Benavora AutoApply", {
    x: MARGIN,
    y: PAGE_H - 73,
    size: 8,
    font,
    color: C_HEADER_SUB,
  });
  y = PAGE_H - 100;

  // ── Submission Details ───────────────────────────────────────────────────────
  sectionHead("SUBMISSION DETAILS");

  const submittedAt = submission.submitted_at
    ? new Date(submission.submitted_at).toLocaleString("en-US", {
        dateStyle: "long",
        timeStyle: "short",
      })
    : new Date().toLocaleString("en-US", {
        dateStyle: "long",
        timeStyle: "short",
      });

  if (aboveFooter()) field("Submission Date", submittedAt);
  if (aboveFooter()) field("Funder", funderName);
  if (aboveFooter()) field("Status", "SUBMITTED ✓", C_GREEN);
  if (aboveFooter() && submission.confirmation_number) {
    field("Confirmation No.", submission.confirmation_number);
  }
  if (aboveFooter()) {
    field("Submission ID", submission.id.slice(0, 8).toUpperCase() + "...");
  }

  // ── Request Details ──────────────────────────────────────────────────────────
  const reqType =
    requestProfile?.request_type ?? submission.request_type ?? null;
  const reqAmount =
    submission.request_amount ?? requestProfile?.min_value ?? null;

  if (aboveFooter() && (requestProfile ?? reqType ?? reqAmount != null)) {
    sectionHead("REQUEST DETAILS");
    if (aboveFooter() && requestProfile?.name) {
      field("Profile", requestProfile.name);
    }
    if (aboveFooter() && reqType) {
      field("Request Type", capitalize(reqType));
    }
    if (aboveFooter() && reqAmount != null) {
      const maxVal = requestProfile?.max_value;
      if (maxVal != null && maxVal !== reqAmount) {
        field(
          "Amount Range",
          `${formatCurrency(reqAmount)} – ${formatCurrency(maxVal)}`,
        );
      } else {
        field("Amount Requested", formatCurrency(reqAmount));
      }
    }
  }

  // ── Confirmation Details ─────────────────────────────────────────────────────
  if (aboveFooter() && confirmationData) {
    const cd = confirmationData;
    const hasContent =
      cd.confirmation_number ??
      cd.expected_response_date ??
      cd.next_steps ??
      cd.contact_for_questions;
    if (hasContent) {
      sectionHead("CONFIRMATION DETAILS");
      if (aboveFooter() && cd.confirmation_number) {
        field("Confirmation #", cd.confirmation_number);
      }
      if (aboveFooter() && cd.reference_id) {
        field("Reference ID", cd.reference_id);
      }
      if (aboveFooter() && cd.expected_response_date) {
        field("Expected Response", cd.expected_response_date);
      }
      if (aboveFooter() && cd.contact_for_questions) {
        field("Contact", cd.contact_for_questions);
      }
      if (aboveFooter() && cd.next_steps) {
        const ns = cd.next_steps;
        field("Next Steps", ns.length > 80 ? ns.slice(0, 80) + "..." : ns);
      }
      if (aboveFooter() && cd.thank_you_message) {
        const tm = cd.thank_you_message;
        field("Message", tm.length > 80 ? tm.slice(0, 80) + "..." : tm);
      }
    }
  }

  // ── Description Submitted ────────────────────────────────────────────────────
  const pitch =
    (submission.personalized_pitch as string | null | undefined) ??
    submission.request_description;

  if (aboveFooter() && pitch) {
    sectionHead("DESCRIPTION SUBMITTED");
    const excerpt = pitch.slice(0, 500);
    const lines = wrapText(excerpt, CONTENT_W, font, 9);
    const maxLines = Math.min(lines.length, 7);
    for (let i = 0; i < maxLines; i++) {
      if (!aboveFooter()) break;
      drawText(lines[i] ?? "", { color: C_DARK_GRAY });
      y -= LH;
    }
    if (lines.length > 7 && aboveFooter()) {
      drawText("...", { color: C_GRAY });
      y -= LH;
    }
  }

  // ── Screenshots ──────────────────────────────────────────────────────────────
  if (aboveFooter() && screenshots && screenshots.length > 0) {
    sectionHead("SCREENSHOTS CAPTURED");
    for (const shot of screenshots.slice(0, 5)) {
      if (!aboveFooter()) break;
      const filename = shot.path.split("/").pop() ?? shot.path;
      drawText(`• ${shot.stage}: ${filename}`, { color: C_GRAY });
      y -= LH;
    }
  }

  // ── Footer ───────────────────────────────────────────────────────────────────
  page.drawLine({
    start: { x: MARGIN, y: 52 },
    end: { x: PAGE_W - MARGIN, y: 52 },
    thickness: 0.5,
    color: C_LIGHT_GRAY,
  });
  page.drawText(
    `Generated by Benavora AutoApply on ${new Date().toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })}`,
    { x: MARGIN, y: 36, size: 7, font, color: C_GRAY },
  );

  // ── Serialize PDF ────────────────────────────────────────────────────────────
  const pdfBytes = await pdfDoc.save();
  const pdfBuffer = Buffer.from(pdfBytes);

  const orgId = submission.organization_id;
  const submissionId = submission.id;
  const storagePath = `${orgId}/receipts/${submissionId}.pdf`;

  // Upload to Supabase Storage (best-effort — failures are logged, not thrown)
  const { error: uploadError } = await supabase.storage
    .from("autoapply-screenshots")
    .upload(storagePath, pdfBuffer, {
      contentType: "application/pdf",
      upsert: true,
    });

  if (uploadError) {
    console.warn(
      "[ReceiptGenerator] Storage upload failed:",
      uploadError.message,
    );
  }

  // Persist receipt record
  const receiptData = {
    org_name: orgName,
    funder_name: funderName,
    request_type: submission.request_type,
    request_amount: submission.request_amount,
    confirmation_number: submission.confirmation_number,
    status: submission.status,
    submitted_at: submission.submitted_at,
    profile_name: requestProfile?.name ?? null,
    has_confirmation_data: confirmationData != null,
    screenshot_count: screenshots?.length ?? 0,
  };

  const { error: dbError } = await supabase
    .from("submission_receipts")
    .insert({
      submission_id: submissionId,
      organization_id: orgId,
      receipt_pdf_path: uploadError ? null : storagePath,
      receipt_data: receiptData,
    });

  if (dbError) {
    console.warn("[ReceiptGenerator] DB insert failed:", dbError.message);
  }

  return pdfBuffer;
}
