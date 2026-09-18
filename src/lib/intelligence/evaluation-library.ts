import Anthropic from '@anthropic-ai/sdk'
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { createClient } from '@/lib/supabase/server'
import { withClaudeLimit } from '@/lib/ai/claude-concurrency'
import {
  EVALUATION_TEMPLATES,
  KPI_DATABASE,
  type EvaluationFramework,
  type KPI,
} from './data/evaluation-templates'

export type { EvaluationFramework, KPI }

// Matches the intelligence_evaluation_frameworks columns defined in
// supabase/migrations/048_grant_intelligence.sql — the table has no
// separate design/analysis-plan columns, only framework_name/example_text.
interface EvaluationFrameworkRow {
  category: string
  framework_name: string | null
  kpis: unknown
  data_collection_methods: unknown
  reporting_frequency: string | null
  example_text: string | null
}

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (anthropicClient === null) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error("Missing required env var: ANTHROPIC_API_KEY")
    anthropicClient = createTrackedAnthropic({ apiKey }, "evaluation-library")
  }
  return anthropicClient
}

function toKpiArray(raw: unknown): KPI[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is KPI =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>)['name'] === 'string' &&
      typeof (item as Record<string, unknown>)['definition'] === 'string',
  )
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

function normalizeCategoryKey(programCategory: string): string {
  return programCategory.toLowerCase().replace(/[\s-]/g, '_')
}

function closestTemplateKey(normalized: string): string | null {
  // Direct match
  if (normalized in EVALUATION_TEMPLATES) return normalized

  // Partial match — e.g. "transitional_housing" should hit "housing"
  const keys = Object.keys(EVALUATION_TEMPLATES)
  for (const key of keys) {
    if (normalized.includes(key) || key.includes(normalized)) return key
  }

  // Keyword-based fallback
  if (normalized.includes('hous') || normalized.includes('shelter')) return 'housing'
  if (normalized.includes('substanc') || normalized.includes('drug') || normalized.includes('alcohol') || normalized.includes('recov')) return 'substance_abuse_treatment'
  if (normalized.includes('work') || normalized.includes('employ') || normalized.includes('job') || normalized.includes('labor')) return 'workforce_development'
  if (normalized.includes('youth') || normalized.includes('teen') || normalized.includes('child') || normalized.includes('mentor')) return 'youth_programs'
  if (normalized.includes('food') || normalized.includes('hunger') || normalized.includes('nutrition') || normalized.includes('pantry')) return 'food_assistance'
  if (normalized.includes('mental') || normalized.includes('behav') || normalized.includes('counsel') || normalized.includes('therap')) return 'mental_health'
  if (normalized.includes('reent') || normalized.includes('criminal') || normalized.includes('justice') || normalized.includes('incarc') || normalized.includes('prison')) return 'reentry_criminal_justice'

  return null
}

export class EvaluationLibrary {
  async getFrameworkByCategory(programCategory: string): Promise<EvaluationFramework> {
    const supabase = createClient()

    const { data } = await supabase
      .from('intelligence_evaluation_frameworks')
      .select('category, framework_name, kpis, data_collection_methods, reporting_frequency, example_text')
      .eq('category', programCategory)
      .limit(1)
      .maybeSingle()

    if (data) {
      const row = data as EvaluationFrameworkRow
      return {
        programCategory: row.category,
        evaluationDesign:
          row.example_text ??
          `${row.framework_name ?? row.category} evaluation framework using standard pre/post outcome tracking.`,
        kpis: toKpiArray(row.kpis),
        dataCollectionMethods: toStringArray(row.data_collection_methods),
        reportingSchedule: row.reporting_frequency ? [row.reporting_frequency] : [],
        analysisPlan:
          row.example_text ??
          `Analyze KPI trends against target ranges on a ${row.reporting_frequency ?? 'periodic'} basis.`,
      }
    }

    // Fall back to hardcoded templates
    const normalized = normalizeCategoryKey(programCategory)
    const key = closestTemplateKey(normalized)
    if (key !== null) {
      const template = EVALUATION_TEMPLATES[key]
      if (template) return template
    }

    // Generic fallback
    return {
      programCategory,
      evaluationDesign:
        'Pre/post design comparing baseline participant status at intake to outcomes at program exit and follow-up. ' +
        'Standardized intake assessment documents participant needs and barriers. ' +
        'Exit assessment and 6-month follow-up measure change across primary outcome domains.',
      kpis: await this.getKPIs(programCategory),
      dataCollectionMethods: [
        'Standardized intake assessment form',
        'Program attendance and engagement tracking',
        'Outcome assessment at exit (self-report + case manager verification)',
        '6-month follow-up survey',
        'Case management progress notes',
      ],
      reportingSchedule: [
        'Monthly: Enrollment, attendance, and process metrics — submitted to program manager',
        'Quarterly: Outcome progress report — submitted to funder',
        'Annual: Full evaluation report with trend analysis',
      ],
      analysisPlan:
        'Descriptive statistics for all KPIs with demographic disaggregation. ' +
        'Pre/post comparisons using paired t-tests or McNemar tests as appropriate. ' +
        'Subgroup analysis to identify differential program effectiveness. ' +
        'Annual report compares outcomes to program goals and prior-year baselines.',
    }
  }

  async getKPIs(programCategory: string): Promise<KPI[]> {
    const supabase = createClient()

    const { data } = await supabase
      .from('intelligence_evaluation_frameworks')
      .select('kpis')
      .eq('category', programCategory)
      .limit(1)
      .maybeSingle()

    if (data) {
      const kpis = toKpiArray((data as { kpis: unknown }).kpis)
      if (kpis.length > 0) return kpis
    }

    // Match from hardcoded templates first
    const normalized = normalizeCategoryKey(programCategory)
    const key = closestTemplateKey(normalized)
    if (key !== null) {
      const template = EVALUATION_TEMPLATES[key]
      if (template) return template.kpis
    }

    // Return generic cross-program KPIs from database
    const genericKpiNames = [
      'Program Retention Rate',
      'Client Satisfaction Rate',
      'Referral Completion Rate',
      'New Client Intake Rate',
      'Documentation Compliance Rate',
    ]
    const generic = KPI_DATABASE.filter((k) => genericKpiNames.includes(k.name))
    return generic.length > 0 ? generic : KPI_DATABASE.slice(0, 5)
  }

  getDataCollectionTools(kpis: KPI[]): string[] {
    const tools = new Set<string>()

    for (const kpi of kpis) {
      const src = kpi.data_source.toLowerCase()
      const method = kpi.measurement_method.toLowerCase()

      if (src.includes('hmis')) tools.add('HMIS (Homeless Management Information System)')
      if (src.includes('ehr') || src.includes('electronic health')) tools.add('HIPAA-compliant Electronic Health Record (EHR) system')
      if (src.includes('survey') || method.includes('survey')) tools.add('Participant survey (paper or digital, e.g., SurveyMonkey, Google Forms)')
      if (src.includes('phq') || src.includes('gad') || src.includes('dessa') || src.includes('asi') || src.includes('lsi')) tools.add('Validated standardized assessment instruments (PHQ-9, GAD-7, ASI, DESSA, LSI-R)')
      if (src.includes('pantry') || src.includes('link2feed') || src.includes('usda')) tools.add('Pantry management software (Link2Feed or Pantry Soft) with USDA-compliant distribution logs')
      if (src.includes('twist') || src.includes('wioa')) tools.add('State workforce tracking system (TWIST or comparable WIOA reporting system)')
      if (src.includes('case management') || method.includes('case manager')) tools.add('Case management software (e.g., Apricot, Caspio, Salesforce NPSP, or spreadsheet-based)')
      if (src.includes('school') || method.includes('report card') || method.includes('school records')) tools.add('School records (report cards and disciplinary records with parental consent forms)')
      if (src.includes('urine') || src.includes('drug test')) tools.add('Urine drug screening kit and results log (SAMHSA-approved panels)')
      if (src.includes('csq') || src.includes('satisfaction')) tools.add('Client satisfaction questionnaire (CSQ-8 or custom Likert-scale survey)')
      if (src.includes('intake') || method.includes('intake')) tools.add('Standardized intake form (demographic, service history, and barrier assessment)')
      if (src.includes('attendance') || method.includes('attendance')) tools.add('Attendance tracking sheet or digital sign-in system')
      if (src.includes('follow-up') || method.includes('follow-up')) tools.add('Follow-up survey protocol (telephone interview script or online survey)')
      if (method.includes('pre/post') || method.includes('pre-')) tools.add('Pre/post assessment instrument (matched pair at intake and exit)')
      if (src.includes('court') || src.includes('criminal') || src.includes('tdcj')) tools.add('Criminal justice data match (TDCJ VINE system or state court records — requires data sharing agreement)')
      if (src.includes('pharmacy')) tools.add('Pharmacy medication records (with client consent and HIPAA BAA)')
      if (method.includes('fidelity') || src.includes('fidelity')) tools.add('Fidelity review checklist (model-specific, administered by clinical supervisor)')
      if (method.includes('audit') || src.includes('audit')) tools.add('Case file audit tool (structured checklist for documentation compliance review)')
    }

    // Always include a data management foundation tool
    tools.add('Secure data management system for storing and tracking participant records (spreadsheet, Access database, or case management software)')
    tools.add('Outcome tracking dashboard or reporting template (Excel, Google Sheets, or Tableau) for funder reporting')

    return Array.from(tools)
  }

  async generateEvaluationPlan(
    programDescription: string,
    kpis: KPI[],
    orgCapacity: string,
  ): Promise<string> {
    const kpiList = kpis
      .map(
        (k) =>
          `- ${k.name}: ${k.definition} (Target: ${k.target_range}; Measured by: ${k.measurement_method}; Source: ${k.data_source}; Frequency: ${k.frequency})`,
      )
      .join('\n')

    const tools = this.getDataCollectionTools(kpis)
    const toolList = tools.map((t) => `- ${t}`).join('\n')

    const systemPrompt =
      'You are a nonprofit grants evaluation specialist with expertise in program evaluation design, GPRA reporting, and funder compliance. ' +
      'Write clear, rigorous, and funder-ready evaluation plan sections. ' +
      'Use professional grant language. ' +
      'Be specific about instruments, timelines, and analysis methods. ' +
      'Do not fabricate statistics or claim outcomes not supported by the provided data. ' +
      'Return only the evaluation plan text — no preamble or meta-commentary.'

    const userPrompt = `Write a complete evaluation plan section for this grant application.

PROGRAM DESCRIPTION:
${programDescription}

ORGANIZATIONAL CAPACITY:
${orgCapacity}

KEY PERFORMANCE INDICATORS (KPIs):
${kpiList}

DATA COLLECTION TOOLS AVAILABLE:
${toolList}

EVALUATION PLAN REQUIREMENTS:
1. Evaluation Design (2-3 sentences): Describe the overall design approach (pre/post, longitudinal, comparison group if applicable), and why it is appropriate for this program.
2. Data Collection (bullet list): For each KPI, specify who collects the data, what instrument or tool is used, and at what intervals.
3. Data Management and Quality Assurance: How will data be stored, secured, and validated? Who is responsible?
4. Analysis Plan: What statistical or analytical methods will be used for each KPI? Include both process and outcome measures.
5. Reporting: What reports will be produced, at what frequency, and for which audiences (funder, board, program staff)?
6. Learning and Continuous Improvement: How will evaluation findings be used to improve the program during the grant period?

Write this as a cohesive, professional grant narrative section (not bullet points for section 1 and 6). Use bullet points only for sections 2 and 5. Keep the total length to 600–900 words.`

    const response = await withClaudeLimit(() =>
      getClient().messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    )

    const block = response.content[0]
    if (!block || block.type !== 'text') {
      throw new Error('No text response from Claude for evaluation plan')
    }
    return block.text
  }
}
