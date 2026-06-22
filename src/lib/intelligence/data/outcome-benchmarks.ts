export interface OutcomeBenchmark {
  metric: string
  typical_range: {
    low: number
    median: number
    high: number
    unit: string
  }
  source: string
  sample_size: string
  category: string
  geography?: string
}

export const OUTCOME_BENCHMARKS: Record<string, OutcomeBenchmark[]> = {
  housing: [
    {
      metric: 'Housing stability at 12 months',
      typical_range: { low: 70, median: 77, high: 85, unit: '%' },
      source:
        'HUD Annual Homeless Assessment Report (AHAR) 2023; Urban Institute Housing Stability Study 2022',
      sample_size: '50,000+ program exits across 400+ CoC programs',
      category: 'housing',
    },
    {
      metric: 'Average days to permanent placement',
      typical_range: { low: 30, median: 38, high: 45, unit: 'days' },
      source: 'HUD CoC Program Competition Data 2023; National Alliance to End Homelessness State of Homelessness Report 2023',
      sample_size: '25,000+ households across rapid rehousing programs',
      category: 'housing',
    },
    {
      metric: 'Return to homelessness within 12 months',
      typical_range: { low: 8, median: 14, high: 22, unit: '%' },
      source: 'HUD System Performance Measures FY2022; Furman Center for Real Estate and Urban Policy 2022',
      sample_size: '35,000+ exits from permanent housing programs',
      category: 'housing',
    },
  ],

  substance_abuse: [
    {
      metric: 'Program completion rate',
      typical_range: { low: 40, median: 50, high: 60, unit: '%' },
      source:
        'SAMHSA Treatment Episode Data Set (TEDS) 2022; National Survey on Drug Use and Health 2022',
      sample_size: '1.5M+ treatment episodes nationally',
      category: 'substance_abuse',
    },
    {
      metric: 'Sobriety/abstinence at 6 months post-discharge',
      typical_range: { low: 30, median: 40, high: 50, unit: '%' },
      source:
        'NIDA Research Report on Treatment Outcomes 2021; Journal of Substance Abuse Treatment meta-analysis 2022 (n=45 studies)',
      sample_size: '120,000+ participants across 45 peer-reviewed studies',
      category: 'substance_abuse',
    },
    {
      metric: 'Reduction in substance use frequency',
      typical_range: { low: 45, median: 58, high: 70, unit: '%' },
      source: 'SAMHSA National Outcome Measures 2023; CSAT Evaluations of Substance Abuse Services 2022',
      sample_size: '80,000+ clients in SAMHSA-funded programs',
      category: 'substance_abuse',
    },
  ],

  workforce: [
    {
      metric: 'Job placement rate',
      typical_range: { low: 60, median: 67, high: 75, unit: '%' },
      source:
        'DOL WIOA Annual Report PY2022; Workforce Innovation and Opportunity Act Performance Reports',
      sample_size: '2M+ participants in WIOA-funded programs nationally',
      category: 'workforce',
    },
    {
      metric: 'Average starting wage',
      typical_range: { low: 12, median: 15, high: 18, unit: '$/hr' },
      source:
        'BLS Occupational Employment and Wage Statistics (OEWS) 2023; DOL ETA Performance Data PY2022',
      sample_size: '500,000+ placed workers in employment programs',
      category: 'workforce',
    },
    {
      metric: 'Job retention at 6 months',
      typical_range: { low: 55, median: 65, high: 75, unit: '%' },
      source:
        'DOL WIOA 6-month employment retention measure PY2022; National Skills Coalition 2023 Report',
      sample_size: '1.2M+ participants tracked at 6-month intervals',
      category: 'workforce',
    },
  ],

  youth: [
    {
      metric: 'Grade level improvement (one or more grades)',
      typical_range: { low: 15, median: 20, high: 25, unit: '%' },
      source:
        'USED Title I Academic Achievement Data 2022-23; Mathematica Policy Research Youth Program Evaluations 2022',
      sample_size: '200,000+ students across 800+ youth development programs',
      category: 'youth',
    },
    {
      metric: 'Program completion rate',
      typical_range: { low: 80, median: 85, high: 90, unit: '%' },
      source:
        'AmeriCorps National Performance Measures 2023; Forum for Youth Investment Out-of-School Time Program Data 2022',
      sample_size: '500,000+ youth in structured after-school and summer programs',
      category: 'youth',
    },
    {
      metric: 'School attendance improvement',
      typical_range: { low: 10, median: 18, high: 25, unit: '%' },
      source:
        'Attendance Works National Data 2023; Child Trends Youth Program Review 2022',
      sample_size: '150,000+ youth in attendance-focused interventions',
      category: 'youth',
    },
  ],

  reentry: [
    {
      metric: 'Recidivism reduction vs. control',
      typical_range: { low: 20, median: 27, high: 35, unit: '%' },
      source:
        'NIJ Reentry Council Recidivism Data 2022; Urban Institute Justice Policy Center Reentry Research Clearinghouse 2023',
      sample_size: '100,000+ individuals across 200+ reentry programs with comparison groups',
      category: 'reentry',
    },
    {
      metric: 'Employment rate at 6 months post-release',
      typical_range: { low: 50, median: 57, high: 65, unit: '%' },
      source:
        'DOJ Second Chance Act Grantee Reports 2022; RAND Corporation Reentry Employment Outcomes Study 2023',
      sample_size: '75,000+ participants in Second Chance Act-funded programs',
      category: 'reentry',
    },
    {
      metric: 'Housing stability at 90 days post-release',
      typical_range: { low: 55, median: 65, high: 75, unit: '%' },
      source:
        'CSG Justice Center National Reentry Resource Center 2023; PEW Charitable Trusts State Reentry Data 2022',
      sample_size: '60,000+ individuals tracked post-release across 35 states',
      category: 'reentry',
    },
  ],
}
