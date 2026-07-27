import { NextResponse } from "next/server";

import { requireRole } from "@/lib/auth/role-gate";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function parseCsvRow(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuote = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (ch === '"') {
      if (inQuote && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuote = !inQuote;
      }
    } else if (ch === "," && !inQuote) {
      result.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

function parseCsv(content: string): Record<string, string>[] {
  const lines = content
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length < 1) return [];

  const headerLine = lines[0] ?? "";
  const headers = parseCsvRow(headerLine).map((h) => h.replace(/^"|"$/g, "").trim().toLowerCase());

  // Bare list of emails, one per line, no header row.
  if (!headers.includes("email")) {
    return lines.map((line) => ({ email: line.replace(/^"|"$/g, "").trim() }));
  }

  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;
    const values = parseCsvRow(line);
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h] = values[idx] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

export async function POST(request: Request) {
  const gate = await requireRole("owner");
  if ("error" in gate) return gate.error;

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Invalid form data.", code: "bad_request" },
      { status: 400 },
    );
  }

  const fileEntry = formData.get("file");
  if (!fileEntry || !(fileEntry instanceof File)) {
    return NextResponse.json(
      { error: "file is required.", code: "missing_file" },
      { status: 400 },
    );
  }

  const csvContent = await fileEntry.text();
  const rows = parseCsv(csvContent);

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];
  const supabase = createAdminClient();

  for (const row of rows) {
    const email = row["email"]?.trim().toLowerCase();
    if (!email) {
      skipped++;
      continue;
    }
    const reason = row["reason"]?.trim() || "import";

    const { error } = await supabase
      .from("suppression_list")
      .insert({ email, reason, source: "admin_import" });

    if (error) {
      if ((error as { code?: string }).code === "23505") {
        skipped++;
      } else {
        errors.push(`Failed to insert ${email}.`);
      }
      continue;
    }
    imported++;
  }

  if (imported > 0) {
    const emails = rows
      .map((r) => r["email"]?.trim().toLowerCase())
      .filter((e): e is string => Boolean(e));
    await supabase
      .from("prospects")
      .update({ suppressed: true, suppressed_reason: "import", suppressed_at: new Date().toISOString() })
      .in("email", emails);
  }

  return NextResponse.json({ result: { imported, skipped, errors } }, { status: 201 });
}
