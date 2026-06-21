import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

export type ImportResult = {
  imported: number;
  skipped_suppressed: number;
  skipped_duplicate: number;
  errors: string[];
};

export type FilterCriteria = {
  states?: string[];
  min_revenue?: number;
  max_revenue?: number;
  ntee_codes?: string[];
  has_email?: boolean;
  not_contacted_since?: Date;
  exclude_replied?: boolean;
};

export type Prospect = {
  id: string;
  list_id: string | null;
  ein: string | null;
  org_name: string;
  org_type: string | null;
  email: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  annual_revenue: number | null;
  employee_count: number | null;
  ntee_code: string | null;
  subsection_code: string | null;
  status: string;
  suppressed: boolean;
  suppressed_reason: string | null;
  suppressed_at: string | null;
  last_contacted_at: string | null;
  total_emails_sent: number;
  has_replied: boolean;
  has_converted: boolean;
  converted_org_id: string | null;
  created_at: string;
};

export type ProspectStats = {
  total: number;
  with_email: number;
  suppressed: number;
  contacted: number;
  replied: number;
  converted: number;
  by_state: Record<string, number>;
};

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
  if (lines.length < 2) return [];

  const headerLine = lines[0] ?? "";
  const headers = parseCsvRow(headerLine).map((h) =>
    h.replace(/^"|"$/g, "").trim(),
  );
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

export class ProspectManager {
  private supabase = createAdminClient();

  async importFromCsv(
    csvContent: string,
    listName: string,
    source: string,
  ): Promise<ImportResult> {
    const result: ImportResult = {
      imported: 0,
      skipped_suppressed: 0,
      skipped_duplicate: 0,
      errors: [],
    };

    const rows = parseCsv(csvContent);
    if (rows.length === 0) return result;

    const { data: listData, error: listError } = await this.supabase
      .from("prospect_lists")
      .insert({ name: listName, source })
      .select()
      .single();

    if (listError || !listData) {
      result.errors.push(
        `Failed to create list: ${listError?.message ?? "unknown"}`,
      );
      return result;
    }

    const listId = (listData as { id: string }).id;

    const { data: suppressedData } = await this.supabase
      .from("suppression_list")
      .select("email");
    const suppressedEmails = new Set(
      ((suppressedData ?? []) as { email: string }[]).map((s) =>
        s.email.toLowerCase(),
      ),
    );

    const { data: existingData } = await this.supabase
      .from("prospects")
      .select("ein")
      .eq("list_id", listId)
      .not("ein", "is", null);
    const existingEins = new Set(
      ((existingData ?? []) as { ein: string | null }[])
        .map((e) => e.ein?.toLowerCase() ?? "")
        .filter(Boolean),
    );

    for (const row of rows) {
      try {
        const email = row["email"]?.trim() || null;
        const ein = row["ein"]?.trim() || null;
        const orgName = row["org_name"]?.trim() ?? "";

        if (!orgName) {
          result.errors.push(`Skipping row with missing org_name`);
          continue;
        }

        if (email && suppressedEmails.has(email.toLowerCase())) {
          result.skipped_suppressed++;
          continue;
        }

        if (ein && existingEins.has(ein.toLowerCase())) {
          result.skipped_duplicate++;
          continue;
        }

        const annualRevStr = row["annual_revenue"]?.trim();
        const employeeCountStr = row["employee_count"]?.trim();

        const { error: insertError } = await this.supabase
          .from("prospects")
          .insert({
            list_id: listId,
            ein: ein ?? null,
            org_name: orgName,
            org_type: row["org_type"]?.trim() || null,
            email,
            website: row["website"]?.trim() || null,
            city: row["city"]?.trim() || null,
            state: row["state"]?.trim() || null,
            zip: row["zip"]?.trim() || null,
            annual_revenue: annualRevStr ? parseFloat(annualRevStr) : null,
            employee_count: employeeCountStr
              ? parseInt(employeeCountStr, 10)
              : null,
            ntee_code: row["ntee_code"]?.trim() || null,
            subsection_code: row["subsection_code"]?.trim() || null,
          });

        if (insertError) {
          result.errors.push(
            `Failed to insert ${orgName}: ${insertError.message}`,
          );
          continue;
        }

        if (ein) existingEins.add(ein.toLowerCase());
        result.imported++;
      } catch (e) {
        result.errors.push(
          `Error processing row: ${e instanceof Error ? e.message : "unknown"}`,
        );
      }
    }

    await this.supabase
      .from("prospect_lists")
      .update({ total_prospects: result.imported })
      .eq("id", listId);

    return result;
  }

  async filterProspects(
    listId: string,
    criteria: FilterCriteria,
  ): Promise<Prospect[]> {
    let query = this.supabase
      .from("prospects")
      .select("*")
      .eq("list_id", listId)
      .eq("suppressed", false);

    if (criteria.states && criteria.states.length > 0) {
      query = query.in("state", criteria.states);
    }
    if (criteria.min_revenue !== undefined) {
      query = query.gte("annual_revenue", criteria.min_revenue);
    }
    if (criteria.max_revenue !== undefined) {
      query = query.lte("annual_revenue", criteria.max_revenue);
    }
    if (criteria.ntee_codes && criteria.ntee_codes.length > 0) {
      query = query.in("ntee_code", criteria.ntee_codes);
    }
    if (criteria.has_email) {
      query = query.not("email", "is", null);
    }
    if (criteria.not_contacted_since) {
      query = query.or(
        `last_contacted_at.is.null,last_contacted_at.lt.${criteria.not_contacted_since.toISOString()}`,
      );
    }
    if (criteria.exclude_replied) {
      query = query.eq("has_replied", false);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to filter prospects: ${error.message}`);

    return (data ?? []) as Prospect[];
  }

  async suppressProspect(
    email: string,
    reason: string,
    source: string,
  ): Promise<void> {
    const normalizedEmail = email.toLowerCase().trim();

    const { error: suppressError } = await this.supabase
      .from("suppression_list")
      .insert({ email: normalizedEmail, reason, source });

    // 23505 = unique constraint violation; already suppressed is fine
    if (suppressError && (suppressError as { code?: string }).code !== "23505") {
      throw new Error(`Failed to suppress email: ${suppressError.message}`);
    }

    await this.supabase
      .from("prospects")
      .update({
        suppressed: true,
        suppressed_reason: reason,
        suppressed_at: new Date().toISOString(),
      })
      .eq("email", normalizedEmail);
  }

  async getStats(listId?: string): Promise<ProspectStats> {
    let query = this.supabase
      .from("prospects")
      .select(
        "state, email, suppressed, last_contacted_at, has_replied, has_converted",
      );

    if (listId) {
      query = query.eq("list_id", listId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`Failed to get stats: ${error.message}`);

    const rows = (data ?? []) as Array<{
      state: string | null;
      email: string | null;
      suppressed: boolean;
      last_contacted_at: string | null;
      has_replied: boolean;
      has_converted: boolean;
    }>;

    const by_state: Record<string, number> = {};
    let with_email = 0;
    let suppressed = 0;
    let contacted = 0;
    let replied = 0;
    let converted = 0;

    for (const row of rows) {
      if (row.email) with_email++;
      if (row.suppressed) suppressed++;
      if (row.last_contacted_at) contacted++;
      if (row.has_replied) replied++;
      if (row.has_converted) converted++;
      if (row.state) {
        by_state[row.state] = (by_state[row.state] ?? 0) + 1;
      }
    }

    return {
      total: rows.length,
      with_email,
      suppressed,
      contacted,
      replied,
      converted,
      by_state,
    };
  }
}
