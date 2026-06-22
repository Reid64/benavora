-- Migration 059: Budget Pattern Library
-- Stores budget templates by program category and grant type for the
-- Grant Intelligence Library's budget justification feature.

CREATE TABLE IF NOT EXISTS intelligence_budget_patterns (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  program_category text NOT NULL,
  grant_type text NOT NULL,
  line_items jsonb NOT NULL DEFAULT '[]',
  typical_percentages jsonb DEFAULT '{}',
  justification_examples jsonb DEFAULT '[]',
  source text,
  created_at timestamptz DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_budget_patterns_category_type
  ON intelligence_budget_patterns (program_category, grant_type);

-- Seed: 5 common budget templates

INSERT INTO intelligence_budget_patterns
  (program_category, grant_type, line_items, typical_percentages, justification_examples, source)
VALUES
  (
    'housing',
    'federal',
    '[
      {"name":"Program Director (0.5 FTE)","category":"personnel","typicalPctMin":15,"typicalPctMax":25,"justificationExample":"Program Director at $70,000 annual salary × 50% effort = $35,000. Responsible for day-to-day program oversight, partner coordination, and federal reporting."},
      {"name":"Case Manager (1.0 FTE)","category":"personnel","typicalPctMin":20,"typicalPctMax":30,"justificationExample":"Case Manager at $45,000 annual salary × 100% effort = $45,000. Provides direct services to program participants including housing placement and stabilization support."},
      {"name":"Fringe Benefits","category":"fringe","typicalPctMin":22,"typicalPctMax":28,"justificationExample":"Fringe at 25% of personnel includes FICA (7.65%), health insurance (12%), retirement (3%), and unemployment/workers comp (2.35%)."},
      {"name":"Local Travel","category":"travel","typicalPctMin":2,"typicalPctMax":5,"justificationExample":"Site visits and client home visits at IRS standard mileage rate of $0.67/mile × estimated 5,000 miles = $3,350."},
      {"name":"Office Supplies","category":"supplies","typicalPctMin":1,"typicalPctMax":3,"justificationExample":"Printed materials, folders, and office supplies for case management at $50/participant × 40 participants = $2,000."},
      {"name":"Housing Assistance Funds","category":"contractual","typicalPctMin":20,"typicalPctMax":40,"justificationExample":"Direct rental assistance payments to landlords on behalf of participants per HUD fair market rent schedule for the service area."},
      {"name":"Indirect Costs","category":"indirect","typicalPctMin":8,"typicalPctMax":12,"justificationExample":"10% de minimis rate applied to Modified Total Direct Costs per 2 CFR 200.414."}
    ]',
    '{"personnel":{"min":35,"max":55},"fringe":{"min":10,"max":15},"contractual":{"min":20,"max":40},"indirect":{"min":8,"max":12}}',
    '["All salary levels are based on regional nonprofit compensation surveys and consistent with organizational pay scale.","Housing assistance payments represent direct benefit to clients and are the core programmatic expenditure."]',
    'seed'
  ),
  (
    'youth_services',
    'foundation',
    '[
      {"name":"Youth Program Coordinator (1.0 FTE)","category":"personnel","typicalPctMin":30,"typicalPctMax":45,"justificationExample":"Youth Program Coordinator at $48,000 × 100% = $48,000. Oversees all youth programming, volunteer management, and outcome tracking."},
      {"name":"Part-Time Youth Worker (0.5 FTE)","category":"personnel","typicalPctMin":10,"typicalPctMax":20,"justificationExample":"Part-time Youth Worker at $32,000 × 50% = $16,000. Provides direct mentoring, tutoring, and group facilitation."},
      {"name":"Fringe Benefits","category":"fringe","typicalPctMin":18,"typicalPctMax":25,"justificationExample":"Fringe at 20% covers FICA, health insurance prorated for FTE, and retirement contribution per HR policy."},
      {"name":"Program Supplies","category":"supplies","typicalPctMin":5,"typicalPctMax":10,"justificationExample":"Educational materials, art supplies, sports equipment, and snacks for program participants."},
      {"name":"Field Trips and Events","category":"other","typicalPctMin":5,"typicalPctMax":10,"justificationExample":"Transportation and admission costs for educational field trips tied to program curriculum goals."},
      {"name":"Contract Trainer","category":"contractual","typicalPctMin":10,"typicalPctMax":20,"justificationExample":"Licensed therapist for 2-hour weekly social-emotional learning workshops at $150/hour × 40 weeks = $6,000."}
    ]',
    '{"personnel":{"min":40,"max":65},"fringe":{"min":8,"max":15},"contractual":{"min":10,"max":20},"supplies":{"min":5,"max":10}}',
    '["Foundation grants typically do not allow indirect costs; all costs are direct program expenses.","Personnel allocations reflect actual percentage of time dedicated to grant-funded activities."]',
    'seed'
  ),
  (
    'substance_abuse_treatment',
    'federal',
    '[
      {"name":"Clinical Director (0.25 FTE)","category":"personnel","typicalPctMin":8,"typicalPctMax":15,"justificationExample":"Clinical Director (LCSW) at $85,000 × 25% = $21,250. Provides clinical supervision, quality assurance, and evidence-based practice fidelity."},
      {"name":"Substance Abuse Counselors (2.0 FTE)","category":"personnel","typicalPctMin":25,"typicalPctMax":40,"justificationExample":"Two licensed counselors (LCDC) at $52,000 each × 100% = $104,000. Provide individual and group therapy sessions."},
      {"name":"Peer Recovery Specialist (1.0 FTE)","category":"personnel","typicalPctMin":10,"typicalPctMax":18,"justificationExample":"Certified Peer Recovery Support Specialist at $38,000 × 100% = $38,000. Lived experience provides evidence-based peer support per SAMHSA guidelines."},
      {"name":"Fringe Benefits","category":"fringe","typicalPctMin":22,"typicalPctMax":28,"justificationExample":"Fringe at 26% per organizational benefit schedule filed with DHHS."},
      {"name":"Drug Testing Supplies","category":"supplies","typicalPctMin":3,"typicalPctMax":6,"justificationExample":"SAMHSA-approved urine drug test panels at $8/test × 500 tests = $4,000 for monitoring participant sobriety."},
      {"name":"EHR/Treatment Software","category":"other","typicalPctMin":3,"typicalPctMax":7,"justificationExample":"HIPAA-compliant electronic health record system subscription at $300/month × 12 = $3,600."},
      {"name":"Indirect Costs","category":"indirect","typicalPctMin":8,"typicalPctMax":10,"justificationExample":"De minimis 10% indirect cost rate per 2 CFR 200.414 applied to MTDC."}
    ]',
    '{"personnel":{"min":45,"max":65},"fringe":{"min":12,"max":18},"supplies":{"min":3,"max":8},"indirect":{"min":8,"max":10}}',
    '["All clinical staff meet SAMHSA-required licensure credentials for substance abuse treatment.","Evidence-based practices (CBT, motivational interviewing, SBIRT) are employed per SAMHSA Treatment Improvement Protocols."]',
    'seed'
  ),
  (
    'workforce_development',
    'state',
    '[
      {"name":"Program Manager (0.75 FTE)","category":"personnel","typicalPctMin":15,"typicalPctMax":25,"justificationExample":"Program Manager at $60,000 × 75% = $45,000. Oversees job training curriculum, employer partnerships, and participant tracking per WIOA requirements."},
      {"name":"Workforce Trainer (1.0 FTE)","category":"personnel","typicalPctMin":20,"typicalPctMax":30,"justificationExample":"Certified Workforce Trainer at $50,000 × 100% = $50,000. Delivers occupational skills training and job readiness workshops."},
      {"name":"Job Developer (0.5 FTE)","category":"personnel","typicalPctMin":10,"typicalPctMax":18,"justificationExample":"Job Developer at $55,000 × 50% = $27,500. Maintains employer relationships and secures job placements for program graduates."},
      {"name":"Fringe Benefits","category":"fringe","typicalPctMin":22,"typicalPctMax":28,"justificationExample":"Fringe at 25% per organization''s established benefit schedule consistent with all programs."},
      {"name":"Training Materials","category":"supplies","typicalPctMin":5,"typicalPctMax":10,"justificationExample":"Industry-specific certifications, textbooks, and consumable training supplies at $150/participant × 60 participants."},
      {"name":"Participant Supportive Services","category":"other","typicalPctMin":10,"typicalPctMax":20,"justificationExample":"Transportation assistance, childcare subsidies, and work clothing vouchers to remove barriers to program completion per WIOA Title I."},
      {"name":"Indirect Costs","category":"indirect","typicalPctMin":5,"typicalPctMax":10,"justificationExample":"State indirect cost rate of 8% per executed rate agreement with the Texas Workforce Commission."}
    ]',
    '{"personnel":{"min":40,"max":65},"fringe":{"min":10,"max":18},"other":{"min":10,"max":20},"indirect":{"min":5,"max":10}}',
    '["All participants tracked in state TWIST system per WIOA reporting requirements.","Employer partner MOUs on file demonstrating commitments to interview and hire program graduates."]',
    'seed'
  ),
  (
    'food_assistance',
    'federal',
    '[
      {"name":"Food Pantry Coordinator (0.5 FTE)","category":"personnel","typicalPctMin":10,"typicalPctMax":20,"justificationExample":"Food Pantry Coordinator at $40,000 × 50% = $20,000. Manages food distribution operations, volunteer coordination, and USDA commodity compliance."},
      {"name":"Fringe Benefits","category":"fringe","typicalPctMin":5,"typicalPctMax":10,"justificationExample":"Fringe at 25% of coordinator salary = $5,000."},
      {"name":"Food Purchases","category":"supplies","typicalPctMin":40,"typicalPctMax":60,"justificationExample":"Supplemental food purchases to supplement USDA commodities at $2.50/meal equivalent × 20,000 meals served = $50,000."},
      {"name":"Refrigeration Equipment","category":"equipment","typicalPctMin":10,"typicalPctMax":20,"justificationExample":"Commercial walk-in refrigerator for perishable food storage per USDA food safety requirements. Unit cost $12,500."},
      {"name":"Food Safety Supplies","category":"supplies","typicalPctMin":3,"typicalPctMax":6,"justificationExample":"Gloves, temperature logs, sanitizing supplies, and food packaging materials per ServSafe standards."},
      {"name":"Volunteer Management Software","category":"other","typicalPctMin":2,"typicalPctMax":4,"justificationExample":"VolunteerHub subscription at $150/month × 12 = $1,800 to coordinate 50+ monthly volunteers."},
      {"name":"Indirect Costs","category":"indirect","typicalPctMin":8,"typicalPctMax":10,"justificationExample":"De minimis 10% indirect cost rate per 2 CFR 200.414 applied to Modified Total Direct Costs."}
    ]',
    '{"personnel":{"min":10,"max":20},"supplies":{"min":45,"max":65},"equipment":{"min":10,"max":20},"indirect":{"min":8,"max":10}}',
    '["Food purchases sourced from Feeding America regional food bank network to maximize buying power.","USDA commodity value tracked separately and reported per TEFAP requirements."]',
    'seed'
  )
ON CONFLICT (program_category, grant_type) DO NOTHING;
