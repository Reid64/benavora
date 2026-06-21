import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";
import { EmailContactExtractor } from "@/lib/email/contact-extractor";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const extractor = new EmailContactExtractor();
  const suggestions = await extractor.suggestNewContacts(organizationId);

  return NextResponse.json({ suggestions });
}

interface ImportContactPayload {
  name: string;
  email?: string | null;
  title?: string | null;
  phone?: string | null;
  funder_id: string;
}

interface PostBody {
  thread_id?: string;
  action?: string;
  contacts?: ImportContactPayload[];
}

export async function POST(request: Request) {
  const gate = await requireRole("viewer");
  if ("error" in gate) return gate.error;
  const { organizationId } = gate;

  const body = (await request.json().catch(() => ({}))) as PostBody;

  // Branch: import contacts into the CRM.
  if (body.action === "import") {
    if (!Array.isArray(body.contacts) || body.contacts.length === 0) {
      return NextResponse.json(
        { error: "contacts array is required for action=import" },
        { status: 400 },
      );
    }

    const supabase = createAdminClient();
    const imported: string[] = [];
    const errors: string[] = [];

    for (const c of body.contacts) {
      if (!c.name || !c.funder_id) {
        errors.push(
          `Skipped ${c.email ?? "unknown"}: name and funder_id are required`,
        );
        continue;
      }

      const { data, error } = await supabase
        .from("contacts")
        .insert({
          organization_id: organizationId,
          funder_id: c.funder_id,
          name: c.name,
          email: c.email ?? null,
          title: c.title ?? null,
          phone: c.phone ?? null,
        })
        .select("id")
        .single();

      if (error) {
        errors.push(
          `Failed to import ${c.email ?? c.name}: ${error.message}`,
        );
      } else {
        imported.push((data as { id: string }).id);
      }
    }

    return NextResponse.json({ imported: imported.length, errors });
  }

  // Branch: extract contacts from a specific thread.
  if (!body.thread_id) {
    return NextResponse.json(
      { error: "thread_id is required (or action=import with contacts array)" },
      { status: 400 },
    );
  }

  const extractor = new EmailContactExtractor();
  const contacts = await extractor.extractFromThread(
    body.thread_id,
    organizationId,
  );

  return NextResponse.json({ contacts });
}
