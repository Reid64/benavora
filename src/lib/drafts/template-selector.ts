import type { Database } from '@/types/database';

type DraftTemplateType = Database['public']['Enums']['draft_template_type'];

export type Opportunity = Database['public']['Tables']['opportunities']['Row'];

export interface DraftAutomationConfig {
  preferred_template_rules: Record<string, string> | null;
}

export interface TemplateSelection {
  template_type: DraftTemplateType;
  reasoning: string;
  confidence: number;
}

const VALID_TEMPLATE_TYPES: readonly DraftTemplateType[] = [
  'grant_narrative',
  'donation_request_letter',
  'budget_narrative',
  'impact_statement',
  'letter_of_inquiry',
  'full_proposal',
];

export class TemplateSelector {
  selectTemplate(opportunity: Opportunity, orgConfig?: DraftAutomationConfig): TemplateSelection {
    const rules = orgConfig?.preferred_template_rules;
    if (rules && Object.keys(rules).length > 0) {
      const ruleMatch = this.matchRules(rules, opportunity);
      if (ruleMatch) return ruleMatch;
    }
    return this.applyDefaultRules(opportunity);
  }

  selectMultipleTemplates(opportunity: Opportunity): TemplateSelection[] {
    const primary = this.selectTemplate(opportunity);
    const templates: TemplateSelection[] = [primary];

    const needsBudgetNarrative =
      opportunity.source_type === 'government_federal' ||
      primary.template_type === 'full_proposal';

    if (needsBudgetNarrative && primary.template_type !== 'budget_narrative') {
      templates.push({
        template_type: 'budget_narrative',
        reasoning: 'Federal and full-proposal grants typically require a separate budget narrative',
        confidence: 80,
      });
    }

    return templates;
  }

  private matchRules(
    rules: Record<string, string>,
    opportunity: Opportunity
  ): TemplateSelection | null {
    const category = opportunity.category;
    const sourceType = opportunity.source_type ?? '';

    for (const [pattern, templateType] of Object.entries(rules)) {
      if (
        this.matchesPattern(pattern, category) ||
        (sourceType !== '' && this.matchesPattern(pattern, sourceType))
      ) {
        const validated = this.validateTemplateType(templateType);
        if (validated) {
          return {
            template_type: validated,
            reasoning: `Custom rule match: pattern "${pattern}" → ${templateType}`,
            confidence: 95,
          };
        }
      }
    }

    return null;
  }

  private matchesPattern(pattern: string, value: string): boolean {
    if (pattern.endsWith('*')) {
      return value.startsWith(pattern.slice(0, -1));
    }
    return pattern === value;
  }

  private validateTemplateType(type: string): DraftTemplateType | null {
    return (VALID_TEMPLATE_TYPES as readonly string[]).includes(type)
      ? (type as DraftTemplateType)
      : null;
  }

  private applyDefaultRules(opportunity: Opportunity): TemplateSelection {
    const { category, source_type: sourceType, name } = opportunity;
    const amount =
      opportunity.amount_available ??
      opportunity.amount_max ??
      opportunity.amount_min ??
      0;

    // Rule 1 & 2: Government Federal
    if (sourceType === 'government_federal') {
      if (amount > 100_000) {
        return {
          template_type: 'full_proposal',
          reasoning: 'Federal grant over $100K requires a full proposal',
          confidence: 88,
        };
      }
      return {
        template_type: 'grant_narrative',
        reasoning: 'Federal grant at or below $100K uses grant narrative',
        confidence: 85,
      };
    }

    // Rule 3: Government State
    if (sourceType === 'government_state') {
      return {
        template_type: 'grant_narrative',
        reasoning: 'State government grants use grant narrative format',
        confidence: 85,
      };
    }

    // government_grant category without source_type
    if (category === 'government_grant') {
      if (amount > 100_000) {
        return {
          template_type: 'full_proposal',
          reasoning: 'Government grant over $100K requires a full proposal',
          confidence: 82,
        };
      }
      return {
        template_type: 'grant_narrative',
        reasoning: 'Government grant at or below $100K uses grant narrative',
        confidence: 80,
      };
    }

    // Rule 4: Corporate (any)
    if (
      category === 'corporate_donation' ||
      category === 'corporate_sponsorship' ||
      category === 'corporate_foundation' ||
      sourceType === 'corporate_giving'
    ) {
      return {
        template_type: 'donation_request_letter',
        reasoning: `Corporate category (${category}) uses a donation request letter`,
        confidence: 90,
      };
    }

    // Rule 5 & 6: Private Foundation
    if (category === 'private_foundation' || sourceType === 'private_foundation') {
      if (amount > 50_000) {
        return {
          template_type: 'full_proposal',
          reasoning: 'Private foundation grant over $50K requires full proposal',
          confidence: 85,
        };
      }
      return {
        template_type: 'letter_of_inquiry',
        reasoning: 'Private foundation grant at or below $50K starts with an LOI',
        confidence: 85,
      };
    }

    // Rule 7: Housing Grant
    if (category === 'housing_grant') {
      return {
        template_type: 'grant_narrative',
        reasoning: 'Housing grants use grant narrative format',
        confidence: 82,
      };
    }

    // Rule 8: LOI or "letter of inquiry" in name
    const nameLower = name.toLowerCase();
    if (nameLower.includes('loi') || nameLower.includes('letter of inquiry')) {
      return {
        template_type: 'letter_of_inquiry',
        reasoning: 'Opportunity name indicates letter of inquiry format',
        confidence: 90,
      };
    }

    // Rule 9: "budget" in name
    if (nameLower.includes('budget')) {
      return {
        template_type: 'budget_narrative',
        reasoning: 'Opportunity name indicates budget narrative format',
        confidence: 85,
      };
    }

    // Rule 10: Default fallback
    return {
      template_type: 'grant_narrative',
      reasoning: 'Default fallback: grant narrative',
      confidence: 60,
    };
  }
}
