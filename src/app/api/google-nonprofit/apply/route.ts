// POST /api/google-nonprofit/apply
//
// Receives GoogleNonprofitForm's (src/components/GoogleNonprofitForm.tsx)
// multipart submission - orgInfo/eligibility/contact as JSON-in-FormData
// fields plus registrationDocument/affiliationDocument (required) and any
// number of additionalDocuments (optional) - validates it, uploads the
// documents to the org-scoped `documents` Storage bucket (migration 143),
// stores the application in google_nonprofit_applications (migration 171),
// sends a confirmation email, and returns the new application's id.

import { randomUUID } from "crypto";

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { emailSender } from "@/lib/email/sender";
import { isValidEmail, isNonEmpty } from "@/lib/utils/validators";

export const runtime = "nodejs";

const STORAGE_BUCKET = process.env.STORAGE_DOCUMENTS_BUCKET ?? "documents";

function jsonError(message: string, code: string, status: number) {
  // Consistent error shape across API routes (Behavioral Contracts §16).
  return NextResponse.json({ error: message, code }, { status });
}

type OrgInfo = {
  legalName: string;
  dba: string;
  registrationNumber: string;
  country: string;
  mission: string;
  website: string;
  phone: string;
  email: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
};

type Eligibility = {
  orgType: string;
  isGovernmentEntity: boolean;
  isHospital: boolean;
  isSchool: boolean;
  agreesToTerms: boolean;
};

type ContactInfo = {
  fullName: string;
  role: string;
  email: string;
  phone: string;
};

function parseJsonField<T>(formData: FormData, field: string): T | null {
  const raw = formData.get(field);
  if (typeof raw !== "string") return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function asOptionalString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Sanitize a filename for use as a Storage path segment. */
function safeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(-100);
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { userId, organizationId } = gate;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return jsonError(
      "Request body must be multipart form data.",
      "invalid_body",
      400,
    );
  }

  const orgInfoRaw = parseJsonField<Partial<OrgInfo>>(formData, "orgInfo");
  const eligibilityRaw = parseJsonField<Partial<Eligibility>>(
    formData,
    "eligibility",
  );
  const contactRaw = parseJsonField<Partial<ContactInfo>>(formData, "contact");

  if (!orgInfoRaw || !eligibilityRaw || !contactRaw) {
    return jsonError(
      "orgInfo, eligibility, and contact fields are required and must be valid JSON.",
      "invalid_input",
      400,
    );
  }

  const orgInfo: OrgInfo = {
    legalName: asOptionalString(orgInfoRaw.legalName),
    dba: asOptionalString(orgInfoRaw.dba),
    registrationNumber: asOptionalString(orgInfoRaw.registrationNumber),
    country: asOptionalString(orgInfoRaw.country),
    mission: asOptionalString(orgInfoRaw.mission),
    website: asOptionalString(orgInfoRaw.website),
    phone: asOptionalString(orgInfoRaw.phone),
    email: asOptionalString(orgInfoRaw.email),
    addressLine1: asOptionalString(orgInfoRaw.addressLine1),
    city: asOptionalString(orgInfoRaw.city),
    state: asOptionalString(orgInfoRaw.state),
    postalCode: asOptionalString(orgInfoRaw.postalCode),
  };

  const eligibility: Eligibility = {
    orgType: asOptionalString(eligibilityRaw.orgType),
    isGovernmentEntity: eligibilityRaw.isGovernmentEntity === true,
    isHospital: eligibilityRaw.isHospital === true,
    isSchool: eligibilityRaw.isSchool === true,
    agreesToTerms: eligibilityRaw.agreesToTerms === true,
  };

  const contact: ContactInfo = {
    fullName: asOptionalString(contactRaw.fullName),
    role: asOptionalString(contactRaw.role),
    email: asOptionalString(contactRaw.email),
    phone: asOptionalString(contactRaw.phone),
  };

  // Required-field validation (mirrors GoogleNonprofitForm's canProceed gates
  // for steps 0/1/3 - src/components/GoogleNonprofitForm.tsx).
  const missing: string[] = [];
  if (!isNonEmpty(orgInfo.legalName)) missing.push("orgInfo.legalName");
  if (!isNonEmpty(orgInfo.registrationNumber)) missing.push("orgInfo.registrationNumber");
  if (!isNonEmpty(orgInfo.country)) missing.push("orgInfo.country");
  if (!isNonEmpty(orgInfo.mission)) missing.push("orgInfo.mission");
  if (!isNonEmpty(orgInfo.email)) missing.push("orgInfo.email");
  if (!isNonEmpty(eligibility.orgType)) missing.push("eligibility.orgType");
  if (!eligibility.agreesToTerms) missing.push("eligibility.agreesToTerms");
  if (!isNonEmpty(contact.fullName)) missing.push("contact.fullName");
  if (!isNonEmpty(contact.role)) missing.push("contact.role");
  if (!isNonEmpty(contact.email)) missing.push("contact.email");

  if (missing.length > 0) {
    return jsonError(
      `Missing required field(s): ${missing.join(", ")}.`,
      "missing_required_fields",
      400,
    );
  }

  if (!isValidEmail(orgInfo.email)) {
    return jsonError("orgInfo.email is not a valid email address.", "invalid_input", 400);
  }
  if (!isValidEmail(contact.email)) {
    return jsonError("contact.email is not a valid email address.", "invalid_input", 400);
  }

  const registrationDocument = formData.get("registrationDocument");
  const affiliationDocument = formData.get("affiliationDocument");
  const additionalDocuments = formData
    .getAll("additionalDocuments")
    .filter((f): f is File => f instanceof File && f.size > 0);

  if (!(registrationDocument instanceof File) || registrationDocument.size === 0) {
    return jsonError(
      "A registration/charity status document is required.",
      "missing_document",
      400,
    );
  }
  if (!(affiliationDocument instanceof File) || affiliationDocument.size === 0) {
    return jsonError(
      "A proof-of-affiliation document is required.",
      "missing_document",
      400,
    );
  }

  const applicationId = randomUUID();
  const basePath = `${organizationId}/google-nonprofit-applications/${applicationId}`;
  const admin = createAdminClient();

  async function uploadDocument(file: File, slot: string): Promise<string> {
    const path = `${basePath}/${slot}_${safeFileName(file.name || "document")}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const { error } = await admin.storage
      .from(STORAGE_BUCKET)
      .upload(path, buffer, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (error) throw error;
    return path;
  }

  let registrationDocumentPath: string;
  let affiliationDocumentPath: string;
  const additionalDocumentPaths: string[] = [];

  try {
    registrationDocumentPath = await uploadDocument(
      registrationDocument,
      "registration",
    );
    affiliationDocumentPath = await uploadDocument(
      affiliationDocument,
      "affiliation",
    );
    for (let i = 0; i < additionalDocuments.length; i++) {
      additionalDocumentPaths.push(
        await uploadDocument(additionalDocuments[i]!, `additional_${i}`),
      );
    }
  } catch {
    return jsonError(
      "Could not upload one or more documents. Please try again.",
      "upload_failed",
      500,
    );
  }

  const { data: application, error: insertError } = await admin
    .from("google_nonprofit_applications")
    .insert({
      id: applicationId,
      organization_id: organizationId,
      submitted_by: userId,
      legal_name: orgInfo.legalName,
      dba: orgInfo.dba || null,
      registration_number: orgInfo.registrationNumber,
      country: orgInfo.country,
      mission: orgInfo.mission,
      website: orgInfo.website || null,
      phone: orgInfo.phone || null,
      org_email: orgInfo.email,
      address_line1: orgInfo.addressLine1 || null,
      city: orgInfo.city || null,
      state: orgInfo.state || null,
      postal_code: orgInfo.postalCode || null,
      org_type: eligibility.orgType,
      is_government_entity: eligibility.isGovernmentEntity,
      is_hospital: eligibility.isHospital,
      is_school: eligibility.isSchool,
      agrees_to_terms: eligibility.agreesToTerms,
      contact_full_name: contact.fullName,
      contact_role: contact.role,
      contact_email: contact.email,
      contact_phone: contact.phone || null,
      registration_document_path: registrationDocumentPath,
      affiliation_document_path: affiliationDocumentPath,
      additional_document_paths: additionalDocumentPaths,
      status: "submitted",
    })
    .select("id")
    .single();

  if (insertError || !application) {
    return jsonError(
      "Documents uploaded, but the application could not be saved. Please try again.",
      "save_failed",
      500,
    );
  }

  // Best-effort confirmation email. A send failure never fails the
  // submission - the application is already stored (Contracts §16 pattern
  // for non-critical side effects, mirrored from /api/users/invite).
  let emailed = false;
  try {
    const result = await emailSender.send(organizationId, {
      to: [contact.email],
      subject: "Your Google for Nonprofits application was received",
      body_html: `<p>Hi ${contact.fullName},</p>
<p>We received your Google for Nonprofits application for <strong>${orgInfo.legalName}</strong>.</p>
<p>Google routes verification through Goodstack, its third-party partner. Watch the email on file - including spam/junk - for a message from verifications@mail.goodstack.org, typically within 3-14 business days.</p>
<p>Your application reference ID is <strong>${application.id}</strong>.</p>`,
      body_text: `Hi ${contact.fullName},\n\nWe received your Google for Nonprofits application for ${orgInfo.legalName}.\n\nGoogle routes verification through Goodstack, its third-party partner. Watch the email on file - including spam/junk - for a message from verifications@mail.goodstack.org, typically within 3-14 business days.\n\nYour application reference ID is ${application.id}.`,
    });
    emailed = result.success;
  } catch {
    emailed = false;
  }

  if (emailed) {
    await admin
      .from("google_nonprofit_applications")
      .update({ confirmation_email_sent: true })
      .eq("id", application.id);
  }

  return NextResponse.json({
    applicationId: application.id,
    status: "submitted",
    emailed,
  });
}
