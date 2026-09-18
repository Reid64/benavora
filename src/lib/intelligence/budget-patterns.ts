import Anthropic from '@anthropic-ai/sdk'
import { createTrackedAnthropic } from "@/lib/ai/tracked-anthropic";
import { createClient } from '@/lib/supabase/server'
import { withClaudeLimit } from '@/lib/ai/claude-concurrency'

export const BUDGET_CATEGORIES = [
  'personnel',
  'fringe',
  'travel',
  'equipment',
  'supplies',
  'contractual',
  'construction',
  'other',
  'indirect',
] as const

export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number]

export interface BudgetLineItem {
  name: string
  category: BudgetCategory
  typicalPctMin: number
  typicalPctMax: number
  justificationExample: string
}

export interface BudgetTemplate {
  programCategory: string
  grantType: string
  lineItems: BudgetLineItem[]
  typicalPercentages: Record<string, { min: number; max: number }>
  justificationExamples: string[]
  source?: string | null
}

interface BudgetPatternRow {
  program_category: string
  grant_type: string
  line_items: unknown
  typical_percentages: unknown
  justification_examples: unknown
  source: string | null
}

let anthropicClient: Anthropic | null = null

function getClient(): Anthropic {
  if (anthropicClient === null) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new Error('Missing required env var: ANTHROPIC_API_KEY')
    anthropicClient = createTrackedAnthropic({ apiKey }, "budget-patterns")
  }
  return anthropicClient
}

function toLineItems(raw: unknown): BudgetLineItem[] {
  if (!Array.isArray(raw)) return []
  return raw.filter(
    (item): item is BudgetLineItem =>
      item !== null &&
      typeof item === 'object' &&
      typeof (item as Record<string, unknown>)['name'] === 'string',
  )
}

function toStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((v): v is string => typeof v === 'string')
}

function toPctMap(raw: unknown): Record<string, { min: number; max: number }> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return {}
  return raw as Record<string, { min: number; max: number }>
}

// 2 CFR 200 reference excerpts keyed by cost category.
const FEDERAL_COST_PRINCIPLES: Record<string, string[]> = {
  personnel: [
    '2 CFR 200.430 – Compensation for personal services must be reasonable, documented, and allocable to the federal award.',
    '2 CFR 200.430(i) – Time and effort reporting required for employees working on federal awards; semi-annual certification acceptable for single-award employees.',
    '2 CFR 200.431 – Compensation for leave (vacation, sick, holiday) is allowable when the organization\'s leave policy is consistent and equitable.',
  ],
  fringe: [
    '2 CFR 200.431 – Fringe benefits are allowable if costs are reasonable, required by law or organization policy, and applied consistently.',
    '2 CFR 200.431(b) – Pension costs are allowable when computed on an actuarially consistent basis and funded currently.',
    '2 CFR 200.431(d) – Post-retirement benefits other than pensions are allowable if actuarially determined.',
  ],
  travel: [
    '2 CFR 200.474 – Travel costs are allowable when necessary for the federal award and comply with organization travel policies or GSA per diem rates.',
    '2 CFR 200.474(c) – Airfare must be at the lowest available commercial rate; business class requires prior awarding agency approval.',
    '2 CFR 200.474(b) – Costs for transportation, lodging, subsistence, and related items must be reasonable and conform to organization travel policy.',
  ],
  equipment: [
    '2 CFR 200.439 – Equipment (unit cost $5,000+) must be used for the federal award or properly allocated when shared.',
    '2 CFR 200.313 – Title to equipment purchased with federal funds vests with the non-federal entity subject to federal interest.',
    '2 CFR 200.439(b)(1) – Prior approval required for equipment purchases when the acquisition is specifically identified in the budget narrative.',
  ],
  supplies: [
    '2 CFR 200.453 – Supplies are allowable if reasonable and allocable to the federal award.',
    '2 CFR 200.453(b) – Supplies charged to the award must be consumed or used during the award period.',
    '2 CFR 200.453(c) – Unused supplies at award end with aggregate fair market value exceeding $5,000 must be inventoried and credited to the award or retained with federal compensation.',
  ],
  contractual: [
    '2 CFR 200.317-326 – Procurement standards govern all contracts under federal awards, including requirements for competition and conflict-of-interest policies.',
    '2 CFR 200.318 – Non-federal entities must maintain written procurement standards that prohibit conflicts of interest and ensure fair competition.',
    '2 CFR 200.326 – Contract provisions must include all required clauses per Appendix II to 2 CFR Part 200.',
  ],
  construction: [
    '2 CFR 200.439 – Construction costs are allowable if authorized in the federal award agreement.',
    '2 CFR 200.318-326 – Construction contracts subject to full procurement standards including Davis-Bacon Act prevailing wage requirements for federally assisted construction.',
    '2 CFR 200.439 – Prior written approval required before incurring construction costs.',
  ],
  indirect: [
    '2 CFR 200.414 – Non-federal entities may elect the 10% de minimis rate of Modified Total Direct Costs if they have never had a negotiated indirect cost rate.',
    '2 CFR 200.414(c) – Organizations with a negotiated rate must apply that rate; they may not retroactively apply the de minimis rate.',
    '2 CFR 200 Appendix III/IV/VII – Indirect cost rate proposals for institutions of higher education, non-profits, and state/local governments.',
    '2 CFR 200.68 – Modified Total Direct Costs (MTDC) excludes equipment, capital expenditures, patient care charges, tuition, subcontract amounts over $25K.',
  ],
  other: [
    '2 CFR 200.421-475 – Selected items of cost; each line item must be individually allowable, allocable, and reasonable.',
    '2 CFR 200.405 – Costs must be allocable: benefit the award, be treated consistently, and be documented appropriately.',
    '2 CFR 200.404 – Costs must be reasonable: ordinary and prudent under the circumstances, consistent with sound business practices.',
  ],
}

// Typical fringe rates by org type and state (approximations based on sector norms).
const FRINGE_RATES: Record<string, { rate: number; components: string[] }> = {
  'nonprofit_TX': { rate: 0.25, components: ['FICA 7.65%', 'Health insurance 12%', 'Retirement 3%', 'Unemployment 1%', 'Workers comp 1.35%'] },
  'nonprofit_CA': { rate: 0.30, components: ['FICA 7.65%', 'Health insurance 14%', 'Retirement 3%', 'Unemployment 2.5%', 'Workers comp 2.85%'] },
  'nonprofit_NY': { rate: 0.32, components: ['FICA 7.65%', 'Health insurance 15%', 'Retirement 4%', 'Unemployment 2.5%', 'Workers comp 3.15%'] },
  'nonprofit_FL': { rate: 0.23, components: ['FICA 7.65%', 'Health insurance 11%', 'Retirement 2%', 'Unemployment 1%', 'Workers comp 1.35%'] },
  'nonprofit_default': { rate: 0.27, components: ['FICA 7.65%', 'Health insurance 12%', 'Retirement 3%', 'Unemployment 2%', 'Workers comp 2.35%'] },
  'church_TX': { rate: 0.20, components: ['FICA 7.65%', 'Health insurance 9%', 'Retirement 2%', 'Workers comp 1.35%'] },
  'church_default': { rate: 0.22, components: ['FICA 7.65%', 'Health insurance 10%', 'Retirement 2%', 'Workers comp 2.35%'] },
  'government_default': { rate: 0.40, components: ['FICA 7.65%', 'Health insurance 15%', 'Pension 10%', 'Unemployment 2%', 'Workers comp 5.35%'] },
}

// Fallback hardcoded templates used when the DB has no matching row.
const HARDCODED_TEMPLATES: Record<string, BudgetTemplate> = {
  'housing_federal': {
    programCategory: 'housing',
    grantType: 'federal',
    lineItems: [
      { name: 'Program Director (0.5 FTE)', category: 'personnel', typicalPctMin: 15, typicalPctMax: 25, justificationExample: 'Program Director at $70,000 annual salary × 50% effort = $35,000. Responsible for day-to-day program oversight, partner coordination, and federal reporting.' },
      { name: 'Case Manager (1.0 FTE)', category: 'personnel', typicalPctMin: 20, typicalPctMax: 30, justificationExample: 'Case Manager at $45,000 annual salary × 100% effort = $45,000. Provides direct services to program participants including housing placement and stabilization support.' },
      { name: 'Fringe Benefits', category: 'fringe', typicalPctMin: 22, typicalPctMax: 28, justificationExample: 'Fringe at 25% of personnel includes FICA (7.65%), health insurance (12%), retirement (3%), and unemployment/workers comp (2.35%).' },
      { name: 'Local Travel', category: 'travel', typicalPctMin: 2, typicalPctMax: 5, justificationExample: 'Site visits and client home visits at IRS standard mileage rate of $0.67/mile × estimated 5,000 miles = $3,350.' },
      { name: 'Office Supplies', category: 'supplies', typicalPctMin: 1, typicalPctMax: 3, justificationExample: 'Printed materials, folders, and office supplies for case management at $50/participant × 40 participants = $2,000.' },
      { name: 'Housing Assistance Funds', category: 'contractual', typicalPctMin: 20, typicalPctMax: 40, justificationExample: 'Direct rental assistance payments to landlords on behalf of participants per HUD fair market rent schedule for the service area.' },
      { name: 'Indirect Costs', category: 'indirect', typicalPctMin: 8, typicalPctMax: 12, justificationExample: '10% de minimis rate applied to Modified Total Direct Costs per 2 CFR 200.414.' },
    ],
    typicalPercentages: { personnel: { min: 35, max: 55 }, fringe: { min: 10, max: 15 }, contractual: { min: 20, max: 40 }, indirect: { min: 8, max: 12 } },
    justificationExamples: ['All salary levels are based on regional nonprofit compensation surveys and consistent with organizational pay scale.', 'Housing assistance payments represent direct benefit to clients and are the core programmatic expenditure.'],
    source: 'hardcoded',
  },
  'youth_foundation': {
    programCategory: 'youth_services',
    grantType: 'foundation',
    lineItems: [
      { name: 'Youth Program Coordinator (1.0 FTE)', category: 'personnel', typicalPctMin: 30, typicalPctMax: 45, justificationExample: 'Youth Program Coordinator at $48,000 × 100% = $48,000. Oversees all youth programming, volunteer management, and outcome tracking.' },
      { name: 'Part-Time Youth Worker (0.5 FTE)', category: 'personnel', typicalPctMin: 10, typicalPctMax: 20, justificationExample: 'Part-time Youth Worker at $32,000 × 50% = $16,000. Provides direct mentoring, tutoring, and group facilitation.' },
      { name: 'Fringe Benefits', category: 'fringe', typicalPctMin: 18, typicalPctMax: 25, justificationExample: 'Fringe at 20% covers FICA, health insurance prorated for FTE, and retirement contribution per HR policy.' },
      { name: 'Program Supplies', category: 'supplies', typicalPctMin: 5, typicalPctMax: 10, justificationExample: 'Educational materials, art supplies, sports equipment, and snacks for program participants.' },
      { name: 'Field Trips and Events', category: 'other', typicalPctMin: 5, typicalPctMax: 10, justificationExample: 'Transportation and admission costs for educational field trips tied to program curriculum goals.' },
      { name: 'Contract Trainer', category: 'contractual', typicalPctMin: 10, typicalPctMax: 20, justificationExample: 'Licensed therapist for 2-hour weekly social-emotional learning workshops at $150/hour × 40 weeks = $6,000.' },
    ],
    typicalPercentages: { personnel: { min: 40, max: 65 }, fringe: { min: 8, max: 15 }, contractual: { min: 10, max: 20 }, supplies: { min: 5, max: 10 } },
    justificationExamples: ['Foundation grants typically do not allow indirect costs; all costs are direct program expenses.', 'Personnel allocations reflect actual percentage of time dedicated to grant-funded activities.'],
    source: 'hardcoded',
  },
  'substance_abuse_federal': {
    programCategory: 'substance_abuse_treatment',
    grantType: 'federal',
    lineItems: [
      { name: 'Clinical Director (0.25 FTE)', category: 'personnel', typicalPctMin: 8, typicalPctMax: 15, justificationExample: 'Clinical Director (LCSW) at $85,000 × 25% = $21,250. Provides clinical supervision, quality assurance, and evidence-based practice fidelity.' },
      { name: 'Substance Abuse Counselors (2.0 FTE)', category: 'personnel', typicalPctMin: 25, typicalPctMax: 40, justificationExample: 'Two licensed counselors (LCDC) at $52,000 each × 100% = $104,000. Provide individual and group therapy sessions.' },
      { name: 'Peer Recovery Specialist (1.0 FTE)', category: 'personnel', typicalPctMin: 10, typicalPctMax: 18, justificationExample: 'Certified Peer Recovery Support Specialist at $38,000 × 100% = $38,000. Lived experience provides evidence-based peer support per SAMHSA guidelines.' },
      { name: 'Fringe Benefits', category: 'fringe', typicalPctMin: 22, typicalPctMax: 28, justificationExample: 'Fringe at 26% per organizational benefit schedule filed with DHHS.' },
      { name: 'Drug Testing Supplies', category: 'supplies', typicalPctMin: 3, typicalPctMax: 6, justificationExample: 'SAMHSA-approved urine drug test panels at $8/test × 500 tests = $4,000 for monitoring participant sobriety.' },
      { name: 'EHR/Treatment Software', category: 'other', typicalPctMin: 3, typicalPctMax: 7, justificationExample: 'HIPAA-compliant electronic health record system subscription at $300/month × 12 = $3,600.' },
      { name: 'Indirect Costs', category: 'indirect', typicalPctMin: 8, typicalPctMax: 10, justificationExample: 'De minimis 10% indirect cost rate per 2 CFR 200.414 applied to MTDC.' },
    ],
    typicalPercentages: { personnel: { min: 45, max: 65 }, fringe: { min: 12, max: 18 }, supplies: { min: 3, max: 8 }, indirect: { min: 8, max: 10 } },
    justificationExamples: ['All clinical staff meet SAMHSA-required licensure credentials for substance abuse treatment.', 'Evidence-based practices (CBT, motivational interviewing, SBIRT) are employed per SAMHSA Treatment Improvement Protocols.'],
    source: 'hardcoded',
  },
  'workforce_state': {
    programCategory: 'workforce_development',
    grantType: 'state',
    lineItems: [
      { name: 'Program Manager (0.75 FTE)', category: 'personnel', typicalPctMin: 15, typicalPctMax: 25, justificationExample: 'Program Manager at $60,000 × 75% = $45,000. Oversees job training curriculum, employer partnerships, and participant tracking per WIOA requirements.' },
      { name: 'Workforce Trainer (1.0 FTE)', category: 'personnel', typicalPctMin: 20, typicalPctMax: 30, justificationExample: 'Certified Workforce Trainer at $50,000 × 100% = $50,000. Delivers occupational skills training and job readiness workshops.' },
      { name: 'Job Developer (0.5 FTE)', category: 'personnel', typicalPctMin: 10, typicalPctMax: 18, justificationExample: 'Job Developer at $55,000 × 50% = $27,500. Maintains employer relationships and secures job placements for program graduates.' },
      { name: 'Fringe Benefits', category: 'fringe', typicalPctMin: 22, typicalPctMax: 28, justificationExample: 'Fringe at 25% per organization\'s established benefit schedule consistent with all programs.' },
      { name: 'Training Materials', category: 'supplies', typicalPctMin: 5, typicalPctMax: 10, justificationExample: 'Industry-specific certifications, textbooks, and consumable training supplies at $150/participant × 60 participants.' },
      { name: 'Participant Supportive Services', category: 'other', typicalPctMin: 10, typicalPctMax: 20, justificationExample: 'Transportation assistance, childcare subsidies, and work clothing vouchers to remove barriers to program completion per WIOA Title I.' },
      { name: 'Indirect Costs', category: 'indirect', typicalPctMin: 5, typicalPctMax: 10, justificationExample: 'State indirect cost rate of 8% per executed rate agreement with the Texas Workforce Commission.' },
    ],
    typicalPercentages: { personnel: { min: 40, max: 65 }, fringe: { min: 10, max: 18 }, other: { min: 10, max: 20 }, indirect: { min: 5, max: 10 } },
    justificationExamples: ['All participants tracked in state TWIST system per WIOA reporting requirements.', 'Employer partner MOUs on file demonstrating commitments to interview and hire program graduates.'],
    source: 'hardcoded',
  },
  'food_federal': {
    programCategory: 'food_assistance',
    grantType: 'federal',
    lineItems: [
      { name: 'Food Pantry Coordinator (0.5 FTE)', category: 'personnel', typicalPctMin: 10, typicalPctMax: 20, justificationExample: 'Food Pantry Coordinator at $40,000 × 50% = $20,000. Manages food distribution operations, volunteer coordination, and USDA commodity compliance.' },
      { name: 'Fringe Benefits', category: 'fringe', typicalPctMin: 5, typicalPctMax: 10, justificationExample: 'Fringe at 25% of coordinator salary = $5,000.' },
      { name: 'Food Purchases', category: 'supplies', typicalPctMin: 40, typicalPctMax: 60, justificationExample: 'Supplemental food purchases to supplement USDA commodities at $2.50/meal equivalent × 20,000 meals served = $50,000.' },
      { name: 'Refrigeration Equipment', category: 'equipment', typicalPctMin: 10, typicalPctMax: 20, justificationExample: 'Commercial walk-in refrigerator for perishable food storage per USDA food safety requirements. Unit cost $12,500.' },
      { name: 'Food Safety Supplies', category: 'supplies', typicalPctMin: 3, typicalPctMax: 6, justificationExample: 'Gloves, temperature logs, sanitizing supplies, and food packaging materials per ServSafe standards.' },
      { name: 'Volunteer Management Software', category: 'other', typicalPctMin: 2, typicalPctMax: 4, justificationExample: 'VolunteerHub subscription at $150/month × 12 = $1,800 to coordinate 50+ monthly volunteers.' },
      { name: 'Indirect Costs', category: 'indirect', typicalPctMin: 8, typicalPctMax: 10, justificationExample: 'De minimis 10% indirect cost rate per 2 CFR 200.414 applied to Modified Total Direct Costs.' },
    ],
    typicalPercentages: { personnel: { min: 10, max: 20 }, supplies: { min: 45, max: 65 }, equipment: { min: 10, max: 20 }, indirect: { min: 8, max: 10 } },
    justificationExamples: ['Food purchases sourced from Feeding America regional food bank network to maximize buying power.', 'USDA commodity value tracked separately and reported per TEFAP requirements.'],
    source: 'hardcoded',
  },
}

export class BudgetPatternLibrary {
  async getTemplateByCategory(
    programCategory: string,
    grantType: string,
  ): Promise<BudgetTemplate> {
    const supabase = createClient()

    const { data } = await supabase
      .from('intelligence_budget_patterns')
      .select('program_category, grant_type, line_items, typical_percentages, justification_examples, source')
      .eq('program_category', programCategory)
      .eq('grant_type', grantType)
      .limit(1)
      .maybeSingle()

    if (data) {
      const row = data as BudgetPatternRow
      return {
        programCategory: row.program_category,
        grantType: row.grant_type,
        lineItems: toLineItems(row.line_items),
        typicalPercentages: toPctMap(row.typical_percentages),
        justificationExamples: toStringArray(row.justification_examples),
        source: row.source,
      }
    }

    // Fall back to hardcoded templates
    const key = `${programCategory}_${grantType}`
    const hardcoded = HARDCODED_TEMPLATES[key]
    if (hardcoded) return hardcoded

    // Generic fallback
    return {
      programCategory,
      grantType,
      lineItems: [
        { name: 'Program Staff', category: 'personnel', typicalPctMin: 40, typicalPctMax: 60, justificationExample: 'Program staff salaries allocated by percentage of time devoted to grant activities.' },
        { name: 'Fringe Benefits', category: 'fringe', typicalPctMin: 20, typicalPctMax: 28, justificationExample: 'Fringe at organizational rate per established benefit schedule.' },
        { name: 'Program Supplies', category: 'supplies', typicalPctMin: 5, typicalPctMax: 10, justificationExample: 'Consumable supplies directly used in program delivery.' },
        { name: 'Indirect Costs', category: 'indirect', typicalPctMin: 8, typicalPctMax: 10, justificationExample: '10% de minimis rate on MTDC per 2 CFR 200.414.' },
      ],
      typicalPercentages: { personnel: { min: 40, max: 60 }, fringe: { min: 10, max: 17 }, indirect: { min: 8, max: 10 } },
      justificationExamples: [],
      source: 'generated',
    }
  }

  getFederalCostPrinciples(costCategory: string): string[] {
    const normalized = costCategory.toLowerCase().replace(/[^a-z_]/g, '_')
    return FEDERAL_COST_PRINCIPLES[normalized] ?? [
      '2 CFR 200.405 – Costs must be allocable to the federal award.',
      '2 CFR 200.404 – Costs must be reasonable under the circumstances.',
      '2 CFR 200.403 – Costs must be consistently treated across all programs.',
    ]
  }

  getTypicalFringeRate(
    orgType: string,
    state: string,
  ): { rate: number; components: string[] } {
    const stateUpper = state.toUpperCase()
    const typeKey = orgType.toLowerCase().replace(/[^a-z]/g, '_')

    const stateSpecific = FRINGE_RATES[`${typeKey}_${stateUpper}`]
    if (stateSpecific) return stateSpecific

    const typeDefault = FRINGE_RATES[`${typeKey}_default`]
    if (typeDefault) return typeDefault

    return FRINGE_RATES['nonprofit_default'] ?? { rate: 0.27, components: ['FICA 7.65%', 'Health insurance 12%', 'Retirement 3%', 'Other 4.35%'] }
  }

  getIndirectCostRateGuidance(grantType: string): string {
    const type = grantType.toLowerCase()
    if (type === 'federal') {
      return (
        'Federal grants: Organizations without a negotiated indirect cost rate agreement (NICRA) may use the 10% de minimis rate on Modified Total Direct Costs (MTDC) per 2 CFR 200.414. ' +
        'MTDC excludes equipment (>$5,000/unit), capital expenditures, patient care charges, tuition, and subaward amounts exceeding $25,000 per agreement. ' +
        'Organizations with a NICRA must apply their negotiated rate and may not retroactively elect the de minimis rate.'
      )
    }
    if (type === 'state') {
      return (
        'State grants: Indirect cost treatment varies by state agency. Most state agencies accept either the organization\'s federally negotiated rate or the federal 10% de minimis rate. ' +
        'Some state programs cap indirect at 8–15% of direct costs. Check the specific state RFP for allowable indirect cost language.'
      )
    }
    if (type === 'foundation' || type === 'private_foundation' || type === 'corporate') {
      return (
        'Foundation/corporate grants: Indirect costs are frequently disallowed or capped (typically 10–15% of direct costs). ' +
        'Many foundations require all budget items to be direct program costs. ' +
        'Review the funder\'s grant guidelines for indirect cost policy before including this line item. ' +
        'If indirect is disallowed, ensure all overhead costs are allocated as direct line items with appropriate justification.'
      )
    }
    return (
      'Indirect cost treatment depends on funder type. Federal: de minimis 10% MTDC or negotiated rate. ' +
      'Foundation: often disallowed or capped. State: varies by agency. ' +
      'Always review the specific grant guidelines before including indirect costs in the budget.'
    )
  }

  async generateBudgetNarrative(
    budget: unknown,
    grantType: string,
    orgProfile: unknown,
  ): Promise<string> {
    const indirectGuidance = this.getIndirectCostRateGuidance(grantType)
    const budgetJson = JSON.stringify(budget, null, 2)
    const orgJson = JSON.stringify(orgProfile, null, 2)

    const systemPrompt = `You are a nonprofit grant budget specialist with expertise in 2 CFR 200 federal cost principles and foundation budget requirements. Write clear, concise budget narratives that justify each line item with specific calculations, FTE percentages, and policy references. Use exact dollar amounts and percentages. Do not fabricate salary figures — use only what is provided.`

    const userPrompt = `Write a compliant budget narrative for this ${grantType} grant application.

Organization Profile:
${orgJson}

Budget Line Items:
${budgetJson}

Indirect Cost Guidance:
${indirectGuidance}

Instructions:
- For each line item, write 1-3 sentences justifying the cost, including the calculation (e.g., "$50,000 salary × 50% FTE = $25,000").
- Reference relevant 2 CFR 200 sections for federal grants.
- For fringe benefits, list components (FICA, health insurance, retirement, etc.) and rates.
- For indirect costs, cite the applicable rate authority.
- Write in professional grant language suitable for submission.
- Total all sections and confirm the budget is internally consistent.
- Do NOT fabricate numbers not present in the budget data.`

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
      throw new Error('No text response from Claude for budget narrative')
    }
    return block.text
  }
}
