import "server-only";
import { callClaude } from "@/lib/ai/claude";
import { createAdminClient } from "@/lib/supabase/admin";

const STANDARD_VARIABLES = new Set([
  "org_name",
  "contact_name",
  "funder_name",
  "opportunity_name",
  "deadline_date",
  "amount",
  "program_name",
  "mission_snippet",
]);

export class EmailTemplateEngine {
  renderTemplate(
    template: { subject: string; body: string },
    variables: Record<string, string>,
  ): { subject: string; body: string } {
    const render = (text: string): string =>
      text.replace(/\{([a-z][a-z0-9_]*)\}/gi, (_match, key: string) => {
        if (Object.prototype.hasOwnProperty.call(variables, key)) {
          return variables[key] ?? "";
        }
        throw new Error(`Missing required template variable: {${key}}`);
      });

    return { subject: render(template.subject), body: render(template.body) };
  }

  validateTemplate(template: string): {
    valid: boolean;
    variables: string[];
    errors: string[];
  } {
    const seen = new Set<string>();
    for (const m of template.matchAll(/\{([a-z][a-z0-9_]*)\}/gi)) {
      const v = m[1];
      if (v) seen.add(v);
    }
    const variables = [...seen];
    const errors: string[] = [];
    for (const v of variables) {
      if (!STANDARD_VARIABLES.has(v) && !v.startsWith("custom_")) {
        errors.push(`Unrecognized variable: {${v}}`);
      }
    }
    return { valid: errors.length === 0, variables, errors };
  }

  async generateWithAI(
    context: {
      funderName: string;
      opportunityName?: string;
      purpose: string;
      tone: string;
    },
    orgId: string,
  ): Promise<{ subject: string; body: string; variables: string[] }> {
    const admin = createAdminClient();

    const [orgRes, kbImpactRes, kbProgramRes] = await Promise.all([
      admin
        .from("organizations")
        .select("name, mission_statement")
        .eq("id", orgId)
        .single(),
      admin
        .from("knowledge_base")
        .select("content")
        .eq("organization_id", orgId)
        .eq("category", "impact")
        .order("updated_at", { ascending: false })
        .limit(1),
      admin
        .from("knowledge_base")
        .select("title")
        .eq("organization_id", orgId)
        .eq("category", "program_description")
        .order("updated_at", { ascending: false })
        .limit(1),
    ]);

    const orgName = orgRes.data?.name ?? "";
    const missionStatement = orgRes.data?.mission_statement ?? "";
    const programName = (kbProgramRes.data?.[0]?.title as string | null | undefined) ?? "";
    const impactContent = (kbImpactRes.data?.[0]?.content as string | null | undefined) ?? "";

    const system = `You are an expert nonprofit grant writer creating personalized email templates.
Use {variable_name} placeholders for dynamic content.
Standard variables: {org_name}, {contact_name}, {funder_name}, {opportunity_name}, {deadline_date}, {amount}, {program_name}, {mission_snippet}.
Respond with ONLY a JSON object: {"subject": "...", "body": "...", "variables": ["var1", "var2"]}.`;

    const lines = [
      `Organization: ${orgName}`,
      `Mission: ${missionStatement}`,
      programName ? `Program: ${programName}` : null,
      impactContent ? `Impact: ${impactContent}` : null,
      `Funder: ${context.funderName}`,
      context.opportunityName ? `Opportunity: ${context.opportunityName}` : null,
      `Purpose: ${context.purpose}`,
      `Tone: ${context.tone}`,
    ].filter((l): l is string => l !== null);

    const prompt = `Generate a personalized email template.\n\n${lines.join("\n")}`;

    const response = await callClaude({ prompt, system, maxTokens: 2048 });

    const jsonMatch = response.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch?.[0]) {
      throw new Error("AI did not return a valid JSON template");
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch {
      throw new Error("AI response could not be parsed as JSON");
    }

    const result = parsed as Record<string, unknown>;
    if (typeof result.subject !== "string" || typeof result.body !== "string") {
      throw new Error("AI response missing required subject or body fields");
    }

    const variables = Array.isArray(result.variables)
      ? result.variables.filter((v): v is string => typeof v === "string")
      : [];

    return { subject: result.subject, body: result.body, variables };
  }
}

export const templateEngine = new EmailTemplateEngine();
