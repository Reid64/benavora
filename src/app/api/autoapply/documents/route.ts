// GET  /api/autoapply/documents — list all current org documents.
// POST /api/autoapply/documents — upload a new document (multipart/form-data).
// organization_id is always derived from the authenticated session.

import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { DocumentVault } from "@/lib/autoapply/document-vault";

export const runtime = "nodejs";

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  const vault = new DocumentVault(supabase);
  const documents = await vault.getAllDocuments(organizationId);
  return NextResponse.json({ documents });
}

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId, userId } = gate;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data.", code: "invalid_body" }, { status: 400 });
  }

  const fileEntry = formData.get("file");
  const documentType = formData.get("document_type");
  const expiresAt = formData.get("expires_at");

  if (!(fileEntry instanceof File)) {
    return NextResponse.json(
      { error: "file is required.", code: "missing_file" },
      { status: 400 },
    );
  }

  if (typeof documentType !== "string" || !documentType.trim()) {
    return NextResponse.json(
      { error: "document_type is required.", code: "missing_document_type" },
      { status: 400 },
    );
  }

  const fileBuffer = Buffer.from(await fileEntry.arrayBuffer());
  const vault = new DocumentVault(supabase);

  try {
    const id = await vault.uploadDocument({
      orgId: organizationId,
      documentType: documentType.trim(),
      file: fileBuffer,
      fileName: fileEntry.name,
      mimeType: fileEntry.type || "application/octet-stream",
      uploadedBy: userId,
      expiresAt:
        typeof expiresAt === "string" && expiresAt.trim() ? expiresAt.trim() : undefined,
    });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
