// POST /api/autoapply/templates/test
// Dry-run template test: launches StealthBrowser, navigates to the portal,
// fills form fields WITHOUT submitting, captures a screenshot, and returns
// it as a base64 JPEG data URL together with resolved field values.
//
// NOTE: Requires a Chromium binary at runtime. Works in local Node.js
// development and on the Railway AutoApply worker; will not run inside
// Vercel's serverless environment (same constraint as other Playwright routes).

import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { requireRole } from "@/lib/auth/role-gate";
import { StealthBrowser } from "@/lib/autoapply/stealth-browser";

export const runtime = "nodejs";
export const maxDuration = 120;

// ─── Types ────────────────────────────────────────────────────────────────────

interface OrgRow {
  name: string | null;
  ein: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  mission_statement: string | null;
  vision_statement: string | null;
  founding_date: string | null;
  annual_budget: number | null;
  address_line1: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  service_area: string | null;
  target_population: string | null;
  tax_status: string | null;
}

interface KBEntry {
  category: string | null;
  content: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function buildFillData(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<Record<string, string>> {
  const fillData: Record<string, string> = {};

  const { data: orgData } = await supabase
    .from("organizations")
    .select(
      [
        "name", "ein", "website", "phone", "email",
        "mission_statement", "vision_statement", "founding_date",
        "annual_budget", "address_line1", "city", "state", "zip",
        "service_area", "target_population", "tax_status",
      ].join(", "),
    )
    .eq("id", organizationId)
    .single();

  const org = orgData as OrgRow | null;
  if (org) {
    if (org.name) fillData["org.name"] = org.name;
    if (org.ein) fillData["org.ein"] = org.ein;
    if (org.website) fillData["org.website"] = org.website;
    if (org.phone) fillData["org.phone"] = org.phone;
    if (org.email) fillData["org.contact_email"] = org.email;
    if (org.mission_statement) fillData["org.mission_statement"] = org.mission_statement;
    if (org.vision_statement) fillData["org.vision_statement"] = org.vision_statement;
    if (org.founding_date) {
      fillData["org.founded_year"] = String(new Date(org.founding_date).getFullYear());
    }
    if (org.annual_budget != null) {
      fillData["org.annual_budget"] = org.annual_budget.toLocaleString("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      });
    }
    if (org.address_line1) fillData["org.address"] = org.address_line1;
    if (org.city) fillData["org.city"] = org.city;
    if (org.state) fillData["org.state"] = org.state;
    if (org.zip) fillData["org.zip"] = org.zip;
    if (org.service_area) fillData["request.geographic_area"] = org.service_area;
    if (org.target_population) fillData["request.population_served"] = org.target_population;
    if (org.tax_status) fillData["org.501c3_status"] = org.tax_status;
  }

  const { data: kbData } = await supabase
    .from("knowledge_base_entries")
    .select("category, content")
    .eq("organization_id", organizationId);

  for (const entry of (kbData as KBEntry[] | null) ?? []) {
    const cat = (entry.category ?? "").toLowerCase();
    const text = entry.content ?? "";
    if (!text) continue;

    if (cat.includes("contact_name") || cat.includes("executive_director")) {
      fillData["org.contact_name"] ??= text;
    }
    if (cat.includes("contact_title")) {
      fillData["org.contact_title"] ??= text;
    }
    if (cat.includes("program") && !cat.includes("program_description")) {
      const prev = fillData["org.program_description"];
      fillData["org.program_description"] = prev ? `${prev}\n${text}` : text;
    }
    if (cat === "program_description" || cat.includes("program_description")) {
      fillData["org.program_description"] ??= text;
    }
    if (cat.includes("impact")) {
      fillData["org.impact_statement"] ??= text;
    }
    if (cat.includes("ntee")) {
      fillData["org.ntee_code"] ??= text;
    }
  }

  const mission =
    fillData["org.mission_statement"] ?? fillData["org.name"] ?? "our organization";
  fillData["request.description"] ??= `We are requesting support for ${mission}`;
  fillData["request.project_name"] ??= fillData["org.name"] ?? "Our Program";
  fillData["request.amount"] ??= "$10,000";
  fillData["request.timeline"] ??= "12 months";
  fillData["request.outcomes"] ??= "Improved community outcomes through our programs";

  return fillData;
}

// ─── Route ────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const gate = await requireRole("writer");
  if ("error" in gate) return gate.error;
  const { supabase, organizationId } = gate;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const { templateId } = (body ?? {}) as { templateId?: unknown };
  if (typeof templateId !== "string" || templateId.trim() === "") {
    return NextResponse.json({ error: "templateId is required." }, { status: 400 });
  }

  // Load template — verify org ownership to prevent IDOR
  const { data: templateData, error: tplErr } = await supabase
    .from("form_templates")
    .select("id, portal_url, field_mapping")
    .eq("id", templateId.trim())
    .eq("organization_id", organizationId)
    .single();

  if (tplErr || !templateData) {
    return NextResponse.json({ error: "Template not found." }, { status: 404 });
  }

  const tpl = templateData as { id: string; portal_url: string; field_mapping: unknown };
  const rawMapping = tpl.field_mapping;
  const fieldMapping: Record<string, string> =
    rawMapping && typeof rawMapping === "object" && !Array.isArray(rawMapping)
      ? (rawMapping as Record<string, string>)
      : {};

  const fillData = await buildFillData(supabase, organizationId);

  // Build resolved field-value map for the UI preview
  const fieldValues: Record<string, string> = {};
  for (const [formField, kbKey] of Object.entries(fieldMapping)) {
    if (!kbKey || kbKey === "__skip__") {
      fieldValues[formField] = kbKey === "__skip__" ? "(skipped)" : "(not mapped)";
    } else if (fillData[kbKey]) {
      fieldValues[formField] = fillData[kbKey].slice(0, 120);
    } else {
      fieldValues[formField] = `${kbKey} — no value in KB`;
    }
  }

  // Launch browser, fill form (no submit), capture screenshot
  const stealthBrowser = new StealthBrowser();
  const session = await stealthBrowser.launch();

  try {
    await session.page.goto(tpl.portal_url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    // Wait for dynamic content
    await session.page.waitForTimeout(2000);

    for (const [kbKey, selector] of Object.entries(fieldMapping)) {
      if (!selector || kbKey === "__skip__" || selector === "__skip__") continue;
      // Skip file upload fields in dry run
      if (kbKey.startsWith("doc.")) continue;

      const value = fillData[kbKey];
      if (!value) continue;

      try {
        const fieldType = await session.page
          .evaluate((sel: string): string => {
            const el = document.querySelector(sel);
            if (!el) return "unknown";
            const tag = el.tagName.toLowerCase();
            if (tag === "select") return "select";
            if (tag === "textarea") return "textarea";
            if (tag === "input") return (el as HTMLInputElement).type || "text";
            return "unknown";
          }, selector)
          .catch((): string => "unknown");

        if (
          fieldType === "unknown" ||
          fieldType === "file" ||
          fieldType === "hidden" ||
          fieldType === "checkbox" ||
          fieldType === "radio"
        ) {
          continue;
        }

        if (fieldType === "select") {
          await session.page
            .selectOption(selector, { label: value })
            .catch(() => session.page.selectOption(selector, value).catch(() => null));
        } else {
          await session.page.fill(selector, value).catch(() => null);
        }
      } catch {
        // Per-field errors are non-fatal in dry run
      }
    }

    const screenshotBuffer = (await session.page.screenshot({
      type: "jpeg",
      quality: 75,
      fullPage: false,
    })) as Buffer;

    const screenshotDataUrl = `data:image/jpeg;base64,${screenshotBuffer.toString("base64")}`;

    return NextResponse.json({ screenshotDataUrl, fieldValues });
  } catch {
    return NextResponse.json({ error: "Dry test failed." }, { status: 500 });
  } finally {
    await session.context.close().catch(() => null);
  }
}
