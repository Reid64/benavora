// ============================================================================
// BENAVORA — Intelligence Library corpus seed
//
// Seeds intelligence_funded_proposals with 20 hand-written high-quality
// examples (5 each: NIH community health, HUD housing, DOJ justice, USDA
// rural development) to give the Funding Knowledge Engine and Draft
// Generator real narrative material while the live ingestion scripts
// (ingest-nih-reporter.ts, etc.) continue building out the corpus.
//
// Schema note: intelligence_funded_proposals (supabase/migrations/048_grant_intelligence.sql)
// has no title/abstract/agency/fiscal_year/organization columns. Title +
// abstract combine into full_text, title alone also goes into grant_program,
// agency maps to funder_type, fiscal_year maps to the real award_year column,
// and organization (recipient) is carried in metadata — same convention used
// by scripts/ingest-nih-reporter.ts.
//
//   pnpm seed:intelligence
// ============================================================================

import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

import { createAdminClient } from "../src/lib/supabase/admin";

interface SeedProposal {
  title: string;
  abstract: string;
  funderName: string;
  agency: string;
  awardAmount: number;
  fiscalYear: 2023 | 2024;
  organization: string;
  source: string;
  sourceUrl: string;
  category: string[];
}

const NIH_PROPOSALS: SeedProposal[] = [
  {
    title: "Community-Based Diabetes Prevention and Management Initiative in Rural Appalachia",
    abstract:
      "This project implements a community health worker (CHW) model to reduce type 2 diabetes incidence and improve glycemic control among 1,200 high-risk adults across six rural Appalachian counties with limited access to endocrinology care. Trained CHWs, recruited from the communities they serve, deliver a 16-week evidence-based lifestyle intervention adapted from the National Diabetes Prevention Program, incorporating culturally tailored nutrition education, group exercise sessions held in churches and community centers, and one-on-one coaching on medication adherence. The intervention is paired with a mobile health unit that provides quarterly A1C screening, foot exams, and telehealth connections to endocrinologists at the regional academic medical center, closing a critical specialty-care gap in counties where the nearest endocrinologist is over 90 miles away. A stepped-wedge cluster randomized design allows all six counties to eventually receive the intervention while generating rigorous comparative effectiveness data. Primary outcomes include change in A1C at 12 months, weight loss, and diabetes-related emergency department utilization; secondary outcomes track blood pressure, medication adherence, and patient-reported quality of life. The project builds sustainable local capacity by certifying 24 CHWs through a state-recognized credentialing program, ensuring the intervention continues beyond the funding period. Prior pilot data from two of the six counties demonstrated a 0.8-point A1C reduction and 22% increase in guideline-concordant screening, supporting the scalability of this model to the full six-county service area and, ultimately, to similar rural regions nationally.",
    funderName: "NIH",
    agency: "National Institute of Diabetes and Digestive and Kidney Diseases (NIDDK)",
    awardAmount: 1450000,
    fiscalYear: 2024,
    organization: "Appalachian Community Health Partners, Inc.",
    source: "NIH_NIAID",
    sourceUrl: "https://reporter.nih.gov/project-details/10784562",
    category: ["health", "chronic_disease", "community_health"],
  },
  {
    title: "Peer-Led HIV Prevention and Linkage-to-Care Program for Underserved Urban Populations",
    abstract:
      "This community-based participatory research project deploys a peer navigator model to increase HIV testing uptake, PrEP initiation, and linkage-to-care among Black and Latino men who have sex with men in three underserved urban neighborhoods with HIV incidence rates three times the county average. Twelve peer navigators, themselves members of the priority population, are trained in motivational interviewing, trauma-informed engagement, and PrEP navigation, and are embedded in barbershops, community centers, and mobile testing vans to reduce stigma-related barriers to clinical settings. The program uses a hybrid outreach model combining in-person engagement with a secure texting platform for appointment reminders and confidential Q&A, informed by formative focus groups with 40 community members conducted during the planning phase. Participants who test positive are connected within 72 hours to a rapid-start antiretroviral therapy protocol at partnering federally qualified health centers, while HIV-negative participants at elevated risk are offered same-day PrEP prescribing through a co-located pharmacist collaborative practice agreement. The evaluation plan tracks testing volume, PrEP uptake and 6-month persistence, time to viral suppression for newly diagnosed participants, and retention in care at 12 months, benchmarked against county surveillance data. A community advisory board of peer navigators, clinicians, and consumer representatives meets quarterly to guide program adaptations. This model directly addresses documented gaps in the Ending the HIV Epidemic initiative's local jurisdictional plan and is designed for replication in comparable mid-sized metro areas.",
    funderName: "NIH",
    agency: "National Institute of Allergy and Infectious Diseases (NIAID)",
    awardAmount: 1980000,
    fiscalYear: 2023,
    organization: "Metro Health Access Coalition",
    source: "NIH_NIAID",
    sourceUrl: "https://reporter.nih.gov/project-details/10792187",
    category: ["health", "hiv_prevention", "community_health"],
  },
  {
    title: "Maternal and Child Health Home Visiting Expansion in the Mississippi Delta",
    abstract:
      "This project expands an evidence-based nurse home visiting model to 350 additional low-income pregnant women and new mothers across five Mississippi Delta counties ranked among the worst nationally for infant mortality and maternal morbidity. Registered nurses conduct home visits from early pregnancy through the child's second birthday, screening for postpartum depression, intimate partner violence, and social needs such as housing instability and food insecurity, and connecting families to WIC, Medicaid enrollment assistance, and early intervention services. The program addresses the region's severe shortage of obstetric providers — four of the five counties have no practicing OB/GYN — by pairing home visits with telehealth prenatal check-ins supervised by a maternal-fetal medicine specialist at the state's academic medical center. A dedicated transportation coordinator arranges rides to in-person appointments, addressing a documented barrier identified in a 2022 community needs assessment showing 61% of enrolled families lack reliable vehicle access. Culturally responsive curricula developed with a local community advisory board address breastfeeding support, safe sleep practices, and postpartum mental health in a majority African American, rural population. Outcome measures include preterm birth rate, breastfeeding initiation and duration, immunization completion by 24 months, and maternal depression screening and treatment engagement, compared against a matched historical cohort. The project also trains two Delta-based nurses as certified home visiting supervisors, building durable regional capacity to sustain and eventually expand the program independent of continued federal support.",
    funderName: "NIH",
    agency: "Eunice Kennedy Shriver National Institute of Child Health and Human Development (NICHD)",
    awardAmount: 2000000,
    fiscalYear: 2024,
    organization: "Delta Family Wellness Network",
    source: "NIH_NIAID",
    sourceUrl: "https://reporter.nih.gov/project-details/10801933",
    category: ["health", "maternal_child_health", "community_health"],
  },
  {
    title: "Community Health Worker Model for Hypertension Control Among Rural Elders",
    abstract:
      "This project tests a community health worker-delivered blood pressure self-monitoring and medication titration support intervention for 600 adults aged 60 and older with uncontrolled hypertension across a nine-county rural service area. Participants receive validated home blood pressure cuffs, weekly CHW home or phone visits during the first three months, and a structured protocol for reporting out-of-range readings to a collaborating physician who can adjust medications remotely without requiring an in-person clinic visit — a critical accommodation given that 40% of the target population lacks reliable transportation. CHWs, recruited from senior centers and faith communities the target population already trusts, receive 60 hours of training covering hypertension pathophysiology, motivational interviewing for medication adherence, and recognition of hypertensive emergency symptoms requiring immediate referral. The intervention explicitly addresses health literacy barriers common among rural elders through teach-back methods and simplified pill organizers correlated with each medication change. A randomized controlled design compares the CHW intervention against enhanced usual care, with the primary outcome being change in systolic blood pressure at six months and secondary outcomes including medication adherence (measured via pharmacy refill data), emergency department visits for hypertensive crisis, and patient self-efficacy scores. Formative work with a 15-member senior advisory council shaped the intervention's pacing and materials for low-vision and low-literacy participants. If successful, the model provides a scalable, low-cost template for rural health systems facing physician shortages and aging populations disproportionately burdened by uncontrolled cardiovascular risk factors.",
    funderName: "NIH",
    agency: "National Heart, Lung, and Blood Institute (NHLBI)",
    awardAmount: 1150000,
    fiscalYear: 2023,
    organization: "Piedmont Rural Health Collaborative",
    source: "NIH_NIAID",
    sourceUrl: "https://reporter.nih.gov/project-details/10813476",
    category: ["health", "chronic_disease", "aging"],
  },
  {
    title: "Behavioral Health Integration in Federally Qualified Health Centers Serving Migrant Farmworker Communities",
    abstract:
      "This project integrates bilingual behavioral health screening and brief intervention services into primary care workflows at four federally qualified health center sites serving an estimated 8,500 migrant and seasonal farmworkers and their families annually. Farmworker communities experience elevated rates of depression, anxiety, and substance use linked to occupational stress, social isolation, immigration-related trauma, and pesticide exposure, yet face profound barriers to specialty behavioral health care including language, transportation, seasonal mobility, and stigma. The project embeds two bilingual, bicultural behavioral health consultants at each site to conduct same-day warm handoffs from primary care providers, deliver brief solution-focused counseling in Spanish and Indigenous languages (Mixteco and Q'anjob'al) via trained interpreters, and coordinate psychiatric consultation through a telepsychiatry partnership with the state's academic medical center. Community health workers conduct outreach at labor camps and packing facilities during peak harvest season to identify individuals in crisis and reduce reliance on emergency departments. A promotora-led psychoeducation curriculum addresses stigma reduction and normalizes help-seeking within farmworker social networks. The evaluation tracks screening completion rates, same-day behavioral health engagement, PHQ-9 and GAD-7 score improvement at follow-up, and reduction in behavioral-health-related emergency department utilization, disaggregated by language and migration pattern. This model responds directly to a documented gap identified through health center data showing behavioral health referral completion rates below 15% under the prior referral-only system, and is designed for replication across the broader network of farmworker-serving health centers nationally.",
    funderName: "NIH",
    agency: "National Institute of Mental Health (NIMH)",
    awardAmount: 1720000,
    fiscalYear: 2024,
    organization: "Sunbelt Migrant Health Alliance",
    source: "NIH_NIAID",
    sourceUrl: "https://reporter.nih.gov/project-details/10826049",
    category: ["health", "behavioral_health", "community_health"],
  },
];

const HUD_PROPOSALS: SeedProposal[] = [
  {
    title: "Permanent Supportive Housing Development for Chronically Homeless Individuals",
    abstract:
      "This project finances the acquisition and rehabilitation of a 48-unit apartment complex to create permanent supportive housing for chronically homeless individuals, including veterans and people with serious mental illness, in a mid-sized metro area where the most recent point-in-time count identified 380 chronically homeless individuals and fewer than 90 dedicated permanent supportive housing beds. The development follows a Housing First model with no sobriety or treatment-compliance prerequisites for admission, paired with on-site case management, a part-time psychiatric nurse practitioner, and peer support specialists with lived experience of homelessness. Units are studio and one-bedroom configurations designed for single adults, with a dedicated ground-floor community space for life-skills programming, a computer lab for benefits enrollment and job searching, and a secure bike and mobility-device storage area addressing an access barrier identified by prospective residents during design charrettes. Rental assistance is layered through a combination of project-based vouchers, HUD Continuum of Care funding, and a state behavioral health rental subsidy, ensuring rents remain affordable to residents whose sole income is SSI. The project also incorporates trauma-informed design principles — private entrances, natural light, and defensible community space — informed by consultation with a formerly homeless resident advisory panel. Projected outcomes include a minimum 85% one-year housing retention rate consistent with national Housing First benchmarks, reduced emergency department and jail utilization among residents tracked through a data-sharing agreement with the county health system, and measurable reduction in the community's chronic homelessness point-in-time count within three years of lease-up.",
    funderName: "HUD",
    agency: "HUD Office of Community Planning and Development — Continuum of Care Program",
    awardAmount: 4200000,
    fiscalYear: 2024,
    organization: "Lone Star Housing Trust",
    source: "HUD",
    sourceUrl: "https://www.hud.gov/coc_program/awards/2024/TX-601-CoC-004821",
    category: ["housing", "homelessness", "supportive_housing"],
  },
  {
    title: "Affordable Multifamily Rehabilitation and Preservation Initiative",
    abstract:
      "This project rehabilitates 120 units across four aging affordable multifamily properties at risk of losing their affordability restrictions within the next five years, preserving housing for approximately 300 low- and moderate-income residents, including 85 senior households, in a coastal community facing severe displacement pressure from rising market rents. Deferred maintenance assessments identified critical needs including roof replacement, HVAC system failures, and non-compliant accessibility features across all four properties, several of which have not undergone substantial rehabilitation since original construction in the 1980s. The scope of work includes full accessibility retrofits to bring 20% of units into ADA compliance for residents with mobility limitations, energy-efficiency upgrades projected to reduce utility costs by an average of 28% per unit, and resilience improvements including elevated mechanical systems and impact-resistant windows given the properties' location in a designated flood-risk zone. A temporary relocation plan, developed in consultation with a resident advisory committee, phases construction building-by-building to minimize displacement, with on-site relocation coordinators and translated materials for the property's substantial Spanish- and Vietnamese-speaking resident population. Long-term affordability is secured through a 30-year renewed land use restriction agreement recorded against each property, permanently preserving the units against conversion to market-rate housing. The project also establishes a resident services coordinator position funded through year five to connect residents to workforce development, health services, and a financial coaching program aimed at building savings and housing stability beyond the subsidized units.",
    funderName: "HUD",
    agency: "HUD Office of Multifamily Housing — Preservation and Rehabilitation",
    awardAmount: 3650000,
    fiscalYear: 2023,
    organization: "Gulf Coast Community Development Corporation",
    source: "HUD",
    sourceUrl: "https://www.hud.gov/coc_program/awards/2023/TX-702-preservation-002214",
    category: ["housing", "affordable_housing", "preservation"],
  },
  {
    title: "Rapid Re-Housing and Homelessness Prevention Program for Families with Children",
    abstract:
      "This project provides short- to medium-term rental assistance and intensive case management to rapidly re-house 220 families with children experiencing homelessness and prevent housing loss for an additional 180 families at imminent risk of eviction, across a five-county service area where family homelessness increased 34% in the two years following the expiration of pandemic-era rental protections. The program follows a progressive engagement model, providing the minimum assistance necessary to achieve housing stability, ranging from one-time move-in assistance and mediation with landlords to up to twelve months of graduated rental subsidy for families with more significant barriers such as poor rental history or eviction records. Housing navigators maintain an actively cultivated list of participating landlords, offering a risk-mitigation fund covering damages beyond the security deposit as an incentive for landlord participation given the tight rental market's low vacancy rate of under 3%. Case managers use a strengths-based, trauma-informed approach to connect families to income supports, including SNAP and TANF benefit enrollment, employment services through a co-located workforce partner, and childcare subsidies that address a documented barrier to parents' ability to maintain employment while housing-unstable. Children in enrolled families are connected to school-based liaisons under the McKinney-Vento Act to prevent disruption to their education during the housing crisis. Outcomes tracked include exits to permanent housing, housing retention at 6 and 12 months post-exit, returns to homelessness, and family income change, benchmarked against the Continuum of Care's coordinated entry system performance standards.",
    funderName: "HUD",
    agency: "HUD Office of Community Planning and Development — Continuum of Care Program",
    awardAmount: 2850000,
    fiscalYear: 2024,
    organization: "Central Texas Housing Alliance",
    source: "HUD",
    sourceUrl: "https://www.hud.gov/coc_program/awards/2024/TX-503-CoC-007733",
    category: ["housing", "homelessness", "family_services"],
  },
  {
    title: "Transitional Housing and Wraparound Services for Survivors of Domestic Violence",
    abstract:
      "This project expands transitional housing capacity from 18 to 34 units and adds comprehensive wraparound services for survivors of domestic violence and their children fleeing unsafe housing situations, in a rural service area where the nearest emergency shelter with confidential locations is over 60 miles away for residents of the three outlying counties. The scattered-site transitional housing model leases units in undisclosed locations across the service area to maintain survivor safety and confidentiality, a critical design element given documented instances of abusers tracking survivors through shelter addresses in the region. Each household is paired with an advocate who provides safety planning, trauma-informed counseling, and assistance navigating civil protective orders, custody proceedings, and public benefits, alongside a housing stability specialist who works toward permanent housing placement within the 18-24 month transitional stay. Children in the program receive dedicated advocacy addressing the trauma of witnessing domestic violence, coordinated with school counselors under confidentiality protocols that protect the family's location. The project addresses a documented gap in economic self-sufficiency support by adding a financial empowerment component including credit repair, employment readiness training, and an emergency micro-grant fund to cover barriers such as work uniforms or certification exam fees that survivors identified in program evaluation surveys as obstacles to stable employment. A 24-hour crisis line, staffed by trained advocates, serves the full rural region and connects callers to both the transitional housing waitlist and emergency safety planning. Outcomes tracked include successful exits to safe permanent housing, reduction in return incidents of violence, and children's school attendance stability during the program period.",
    funderName: "HUD",
    agency: "HUD Office of Community Planning and Development — Continuum of Care Program",
    awardAmount: 1380000,
    fiscalYear: 2023,
    organization: "Hill Country Safe Haven",
    source: "HUD",
    sourceUrl: "https://www.hud.gov/coc_program/awards/2023/TX-604-CoC-001157",
    category: ["housing", "domestic_violence", "transitional_housing"],
  },
  {
    title: "Community Land Trust Expansion for Long-Term Housing Affordability",
    abstract:
      "This project expands an established community land trust's portfolio by acquiring and developing 45 new single-family and duplex homes for permanently affordable homeownership, targeting first-generation homebuyer households earning below 80% of area median income in a rapidly gentrifying metro area where median home prices increased 58% over the preceding four years, pricing out long-time residents. Under the land trust model, the organization retains ownership of the underlying land while selling the home itself to income-qualified buyers at a below-market price, with a 99-year ground lease and resale formula that caps future appreciation to preserve affordability for subsequent generations of buyers rather than allowing a one-time affordability benefit to be lost at first resale — directly addressing the community's documented loss of over 1,200 previously affordable units to market-rate conversion over the past decade. The program includes an eight-week homebuyer education curriculum covering budgeting, mortgage readiness, and maintenance responsibilities, delivered in partnership with a HUD-approved housing counseling agency, along with individualized down payment assistance layered with the land trust's below-market sale price to reach households as low as 50% AMI. Priority is given to households displaced from the target neighborhoods through documented prior residency, addressing the land trust's mission of preventing further displacement of the historically Black and Latino community it serves. Post-purchase support includes a homeowner support fund for emergency repairs and a standing homeowner association that provides peer support and maintains community stewardship of shared green spaces. The project is projected to permanently remove 45 homes from speculative market pressure, with modeled 30-year affordability retention exceeding 95% based on the land trust's existing 15-year portfolio performance.",
    funderName: "HUD",
    agency: "HUD Office of Community Planning and Development — Community Development Block Grant Program",
    awardAmount: 3900000,
    fiscalYear: 2024,
    organization: "East Texas Community Land Trust",
    source: "HUD",
    sourceUrl: "https://www.hud.gov/coc_program/awards/2024/TX-CDBG-clt-005609",
    category: ["housing", "homeownership", "community_land_trust"],
  },
];

const DOJ_PROPOSALS: SeedProposal[] = [
  {
    title: "Community-Based Violence Intervention and Interruption Program",
    abstract:
      "This project deploys a community violence intervention model employing eight credible messenger outreach workers, individuals with lived experience including justice involvement who carry credibility within the target population, to identify and mediate active conflicts before they escalate to gun violence in three neighborhoods accounting for 62% of the city's shooting incidents despite representing only 9% of its population. Outreach workers maintain relationships with individuals identified through hospital-based violence intervention partnerships, probation referrals, and community intelligence as being at highest risk of involvement in gun violence, either as potential victims or perpetrators, providing intensive case management including conflict mediation, life-coaching, and connection to cognitive behavioral therapy addressing trauma and impulse control. A hospital-based component embeds a violence intervention specialist in the regional Level 1 trauma center's emergency department to engage gunshot and stabbing victims at the bedside during the critical window following injury when individuals are most receptive to intervention, working to prevent retaliatory violence and connecting survivors to victim compensation, housing, and employment resources. The program's employment pipeline partners with three local unions and a workforce development board to place participants in apprenticeship programs, addressing the lack of legitimate economic opportunity identified as a primary driver of continued involvement in violence in participant focus groups. A conflict mediation team responds within hours to violent incidents to prevent retaliation cycles, coordinating closely with — but organizationally independent from — the police department to preserve outreach workers' credibility within the community. Outcomes tracked include shooting incidents in target areas, program participant re-involvement in violence, and program enrollment-to-employment placement rate, evaluated against a comparison period using the police department's incident data.",
    funderName: "DOJ",
    agency: "DOJ Office of Justice Programs — Community Violence Intervention and Prevention Initiative",
    awardAmount: 975000,
    fiscalYear: 2024,
    organization: "Urban Peace Collaborative",
    source: "DOJ_OJP",
    sourceUrl: "https://ojp.gov/funding/explore/awards/2024-VI-BX-0142",
    category: ["justice", "violence_prevention", "public_safety"],
  },
  {
    title: "Reentry Services and Workforce Development for Formerly Incarcerated Individuals",
    abstract:
      "This project provides comprehensive reentry services including transitional housing referrals, occupational skills training, and subsidized employment placement for 250 individuals returning from state incarceration to a metro area where the three-year recidivism rate among the target population exceeds 45%. Services begin pre-release through an in-reach partnership with the state department of corrections, allowing case managers to establish relationships and begin release planning up to 90 days before an individual's release date, addressing the well-documented risk of recidivism within the first 72 hours after release when housing and identification document gaps are most acute. Upon release, participants receive rapid assistance obtaining state identification, Social Security cards, and birth certificates, a bureaucratic barrier that formative program data identified as delaying employment eligibility by an average of six weeks under prior unassisted processes. The occupational training component, delivered in partnership with the community college's workforce division, offers OSHA-certified construction trades training and commercial driver's license preparation, industries identified through local labor market analysis as having both strong wage growth and reduced barriers to hiring individuals with felony records. A subsidized transitional employment period of up to 16 weeks with local employer partners allows participants to build a current work history while continuing intensive case management addressing housing stability, substance use recovery support, and family reunification. Peer mentors who have successfully completed their own reentry provide ongoing support groups addressing the isolation and stigma participants report as significant barriers to sustained success. Primary outcomes tracked include employment placement and retention at 6 and 12 months, housing stability, and recidivism at 12 and 36 months post-release, compared against the state's published recidivism benchmarks for the same offense categories.",
    funderName: "DOJ",
    agency: "DOJ Office of Justice Programs — Second Chance Act Adult Reentry Program",
    awardAmount: 850000,
    fiscalYear: 2023,
    organization: "Second Chance Workforce Alliance",
    source: "DOJ_OJP",
    sourceUrl: "https://ojp.gov/funding/explore/awards/2023-CZ-BX-0087",
    category: ["justice", "reentry", "workforce_development"],
  },
  {
    title: "Juvenile Diversion and Restorative Justice Program",
    abstract:
      "This project establishes a restorative justice diversion program serving 180 youth annually referred by juvenile court intake, school resource officers, and municipal police departments as an alternative to formal juvenile court processing for first-time and low-level offenses including theft, vandalism, and minor assault. Trained facilitators convene restorative circles bringing together the youth, the harmed party (when willing to participate), family members, and community members to collaboratively determine accountability measures such as restitution, community service, or a formal apology, grounded in research showing restorative approaches reduce recidivism more effectively than formal court processing for this offense profile while avoiding the long-term collateral consequences of a juvenile record. Youth who successfully complete their restorative agreement, typically within 90 days, have their charges permanently declined for prosecution, while those who do not comply are referred back to standard juvenile court intake, preserving accountability within the diversion model. The program layers wraparound services addressing root causes identified during circle conversations, including a partnership with the school district for truancy intervention, a youth mental health provider offering trauma-focused therapy at no cost to families, and a family strengthening curriculum addressing communication and conflict resolution at home. Facilitators receive 40 hours of restorative justice training and ongoing case consultation, and the program maintains a community volunteer bench of over 30 trained circle keepers reflecting the racial and ethnic composition of the youth served, addressing documented disproportionate minority contact in the county's juvenile justice system. Outcomes tracked include diversion completion rate, victim satisfaction with the restorative process, and 12- and 24-month recidivism compared against a matched cohort processed through traditional juvenile court during the same period.",
    funderName: "DOJ",
    agency: "DOJ Office of Justice Programs — Office of Juvenile Justice and Delinquency Prevention",
    awardAmount: 425000,
    fiscalYear: 2024,
    organization: "Youth Restoration Partners",
    source: "DOJ_OJP",
    sourceUrl: "https://ojp.gov/funding/explore/awards/2024-JU-FX-0033",
    category: ["justice", "juvenile_justice", "restorative_justice"],
  },
  {
    title: "Rural Drug Court Enhancement and Treatment Coordination Initiative",
    abstract:
      "This project enhances an existing rural adult drug court serving a seven-county judicial district by adding a dedicated treatment coordinator position and expanding access to medication-assisted treatment for participants with opioid use disorder, addressing a documented gap in which only one of the district's seven counties has an in-county MAT-prescribing provider, forcing participants to travel up to 70 miles for treatment that is a condition of their program compliance. The treatment coordinator serves as the critical liaison between the court, probation, and a patchwork of behavioral health providers across the rural district, tracking each of the program's 60 active participants' treatment attendance, drug testing results, and clinical progress to inform the court team's judicial status hearings held every two weeks. A newly established telehealth MAT partnership with the regional community mental health center allows participants to receive buprenorphine induction and maintenance monitoring via video visit at the courthouse or a partnering rural health clinic, eliminating the transportation barrier previously causing an estimated 30% of treatment non-compliance findings according to program data from the preceding two years. The enhancement also adds a peer recovery support specialist, in long-term recovery themselves, who provides between-hearing support, transportation coordination to residential treatment when clinically indicated, and connection to recovery housing, addressing housing instability identified as a primary driver of program non-completion in the district's most recent outcome evaluation. Family support services, including a psychoeducation group for participants' family members, address the documented rural challenge of limited community-based recovery support meetings within reasonable driving distance. Outcomes tracked include program completion rate, time to MAT initiation, drug test compliance, graduated sanctions utilization, and 24-month recidivism compared to a matched cohort processed through standard probation.",
    funderName: "DOJ",
    agency: "DOJ Office of Justice Programs — Bureau of Justice Assistance, Adult Drug Court Program",
    awardAmount: 610000,
    fiscalYear: 2023,
    organization: "West Texas Judicial Wellness Coalition",
    source: "DOJ_OJP",
    sourceUrl: "https://ojp.gov/funding/explore/awards/2023-DC-BX-0219",
    category: ["justice", "drug_court", "treatment_coordination"],
  },
  {
    title: "Victim Services Expansion for Rural and Underserved Communities",
    abstract:
      "This project expands victim advocacy and crisis response services across a nine-county rural panhandle region where the sole existing victim services organization operates with two full-time advocates covering an area larger than several states, resulting in documented response delays exceeding 48 hours for non-emergency victim contact following a reported crime. The expansion adds four regionally based bilingual advocates, each covering a two-to-three county cluster, providing 24/7 crisis response, court accompaniment, and assistance completing crime victim compensation applications, a benefit program with historically low utilization in the region attributed to the prior lack of dedicated staff to guide victims through its documentation requirements. A mobile advocacy model equips each advocate with a vehicle and secure mobile technology to meet victims at hospitals, law enforcement agencies, or their homes, addressing the transportation barriers endemic to a service area where the nearest advocate's office may be over an hour's drive from a victim's residence. The program establishes formal protocols with all nine county sheriff's offices and municipal police departments for warm handoff referrals at the scene or during initial law enforcement contact, replacing an inconsistent prior system in which victim notification of available services was left to individual officer discretion. Specialized training addresses the region's significant agricultural worker and colonia populations, including advocates trained in immigration-related victim protections such as U-visa certification support for crime victims cooperating with law enforcement. A regional victim services coordination council, convening quarterly with law enforcement, prosecutors, and healthcare providers, monitors service gaps and referral patterns across the nine counties. Outcomes tracked include victims served, crime victim compensation applications completed and approved, court accompaniment rate, and victim satisfaction survey results collected at case closure.",
    funderName: "DOJ",
    agency: "DOJ Office of Justice Programs — Office for Victims of Crime",
    awardAmount: 540000,
    fiscalYear: 2024,
    organization: "Panhandle Victim Advocacy Network",
    source: "DOJ_OJP",
    sourceUrl: "https://ojp.gov/funding/explore/awards/2024-VA-GX-0071",
    category: ["justice", "victim_services", "rural"],
  },
];

const USDA_PROPOSALS: SeedProposal[] = [
  {
    title: "Rural Community Facilities Grant for Emergency Medical Services Equipment",
    abstract:
      "This project funds the purchase of two fully equipped advanced life support ambulances and a cardiac monitor/defibrillator upgrade for a volunteer EMS cooperative serving a frontier region spanning three counties with a combined population density of under six people per square mile, where the current ambulance fleet includes two units exceeding 180,000 miles and experiencing recurring mechanical failures that have twice caused delayed emergency response in the preceding year. The service area's nearest Level 1 trauma center is over 100 miles away, making reliable, well-equipped transport critical for stabilizing patients during extended transport times that regularly exceed 90 minutes for the most remote ranching communities in the district. The replacement ambulances include four-wheel-drive capability necessary for the region's unpaved and seasonally impassable ranch roads, and are equipped with telemetry systems allowing real-time transmission of cardiac monitoring data to the receiving trauma center, enabling remote physician guidance during transport for time-critical conditions such as STEMI and stroke. The cooperative's 22 volunteer EMTs and paramedics, who otherwise hold full-time jobs in ranching and oil field services across the district, will receive equipment-specific training on the new telemetry and monitoring systems through a partnership with the regional EMS training academy. The project addresses a documented capacity gap identified in the district's most recent community health needs assessment, which found response time reliability as the top-rated healthcare access concern among surveyed residents. Sustainability is addressed through the cooperative's existing county-supported operating levy, which covers ongoing maintenance and fuel costs once the capital equipment is in place, ensuring the investment extends the cooperative's service capacity for a projected 12-15 year vehicle lifecycle.",
    funderName: "USDA",
    agency: "USDA Rural Development — Community Facilities Direct Loan and Grant Program",
    awardAmount: 385000,
    fiscalYear: 2024,
    organization: "Big Bend Rural EMS Cooperative",
    source: "USDA",
    sourceUrl: "https://www.rd.usda.gov/newsroom/news-release/usda-invests-tx-cf-ems-2024-0361",
    category: ["rural_development", "emergency_services", "community_facilities"],
  },
  {
    title: "Rural Housing Preservation and Home Repair Program for Low-Income Elderly Homeowners",
    abstract:
      "This project provides critical home repairs to 65 low-income elderly and disabled homeowners across a rural six-county service area, addressing health and safety hazards including failing roofs, non-functional heating systems, and inaccessible bathrooms that place aging-in-place residents at risk of institutionalization or unsafe living conditions. A needs assessment conducted through the area agency on aging identified that 78% of the target population's owner-occupied homes were built before 1980 and have received no substantial repair investment since original construction, with many homeowners living on fixed incomes that make private-pay contractor repairs financially impossible. Licensed contractors, procured through the organization's existing rehabilitation program infrastructure, complete repairs prioritized by health and safety severity, with accessibility modifications such as grab bars, ramps, and roll-in showers addressing fall risk for the substantial share of participants with mobility limitations documented during intake assessments. The program includes a weatherization component addressing energy inefficiency that formative home energy audits found was contributing to utility burdens exceeding 15% of household income for many participants, well above the 6% threshold considered affordable. A case management component connects participants to additional benefits they may be eligible for but not enrolled in, including property tax exemptions for elderly and disabled homeowners and utility assistance programs, addressing a documented enrollment gap identified through the intake process. Repairs are completed using a deferred forgivable loan structure requiring no repayment as long as the homeowner continues to occupy the property for five years, preserving the long-term affordability and safety of the rural owner-occupied housing stock without displacing elderly residents from homes and communities where they have long-standing ties. Outcomes tracked include repairs completed, homes brought into code compliance, and participant-reported fall incidents and hospitalization rates pre- and post-repair.",
    funderName: "USDA",
    agency: "USDA Rural Development — Very Low-Income Housing Repair Program",
    awardAmount: 295000,
    fiscalYear: 2023,
    organization: "West Texas Rural Housing Coalition",
    source: "USDA",
    sourceUrl: "https://www.rd.usda.gov/newsroom/news-release/usda-invests-tx-504-repair-2023-1187",
    category: ["rural_development", "housing", "aging"],
  },
  {
    title: "Value-Added Producer Grant for Small-Scale Sustainable Agriculture Cooperative",
    abstract:
      "This project funds working capital and processing equipment for a 34-member small-scale farmer cooperative to launch a value-added product line of shelf-stable sauces and preserves made from surplus and cosmetically imperfect produce that member farms currently cannot sell through conventional wholesale channels, addressing an estimated 18% post-harvest loss rate reported by cooperative members prior to the project. The cooperative will lease and equip a shared-use commercial kitchen facility certified for acidified food processing, allowing members to jointly access processing capacity that no individual small farm operation could economically justify on its own, consistent with the cooperative business model's core value proposition of pooled infrastructure investment. A food scientist consultant will support recipe development and safety validation for the initial product line of six sauce and preserve varieties, ensuring compliance with FDA acidified food regulations before commercial sale begins. Market development activities include placement agreements already secured in principle with two regional grocery chains and a farmers market booth program, with projected first-year sales revenue of $180,000 distributed back to member farms based on raw product contribution, directly increasing farm income for participating small-scale producers who have historically operated on thin margins selling only fresh wholesale product. The project includes a producer training component covering food safety certification, cooperative governance, and financial literacy for the cooperative's board, addressing capacity gaps identified during the cooperative's formation process. By creating a market for produce previously sold at a loss or composted, the project directly supports farm viability for member operations averaging under 40 acres, a scale increasingly squeezed out of conventional wholesale markets that favor large-volume producers, while strengthening regional food system resilience and reducing agricultural waste.",
    funderName: "USDA",
    agency: "USDA Rural Development — Value-Added Producer Grant Program",
    awardAmount: 245000,
    fiscalYear: 2024,
    organization: "Panhandle Farmers Cooperative",
    source: "USDA",
    sourceUrl: "https://www.rd.usda.gov/newsroom/news-release/usda-invests-tx-vapg-2024-0742",
    category: ["rural_development", "agriculture", "cooperative"],
  },
  {
    title: "Rural Broadband Feasibility and Community Technology Access Initiative",
    abstract:
      "This project funds a broadband feasibility study and pilot community technology access program for a frontier region where an estimated 62% of households lack access to fixed broadband meeting the FCC's minimum speed threshold, a gap that formative community surveys identified as a primary barrier to telehealth utilization, remote work opportunities, and students' ability to complete schoolwork requiring internet access. The feasibility study engages a licensed telecommunications engineering firm to conduct a technical and financial analysis of fixed wireless and fiber-to-the-home deployment options across the region's challenging terrain, producing an actionable infrastructure investment roadmap that the organization and regional economic development partners can use to pursue subsequent federal and state broadband infrastructure funding at a scale beyond this project's scope. In parallel, the project establishes four community technology access points at existing community centers and libraries, each equipped with public computer workstations, high-speed satellite internet connections, and a part-time digital navigator who provides one-on-one assistance with telehealth portal setup, online benefits applications, and basic digital literacy instruction for residents, particularly elderly community members, who lack home internet access or digital skills. A mobile hotspot lending program, modeled on similar rural library initiatives, allows residents to check out cellular hotspot devices for up to two weeks, addressing acute short-term needs such as completing a telehealth appointment or job application. The digital navigator maintains data on access point usage and resident-reported barriers to inform the subsequent infrastructure investment prioritization. This project is explicitly structured as a foundational planning and interim-access investment, with the feasibility study's findings intended to directly support a future infrastructure grant or loan application once a viable deployment model is identified.",
    funderName: "USDA",
    agency: "USDA Rural Development — Community Connect and Rural Broadband Programs",
    awardAmount: 165000,
    fiscalYear: 2023,
    organization: "Trans-Pecos Connectivity Alliance",
    source: "USDA",
    sourceUrl: "https://www.rd.usda.gov/newsroom/news-release/usda-invests-tx-broadband-2023-0509",
    category: ["rural_development", "broadband", "digital_equity"],
  },
  {
    title: "Rural Business Development Grant for Food Desert Grocery Cooperative",
    abstract:
      "This project provides technical assistance and pre-development funding to establish a member-owned grocery cooperative in a rural county seat that has been without a full-service grocery store for six years since the last remaining independent grocer closed, forcing the town's 2,400 residents to drive an average of 34 miles round-trip for fresh food access, a documented burden falling hardest on the community's elderly and low-income residents without reliable vehicle access. The project funds a feasibility study assessing store size, product mix, and financial projections tailored to the community's demographics and existing spending patterns, along with a cooperative development consultant who guides the community organizing committee through cooperative formation, bylaws development, and member-share capital campaign planning. A market analysis component surveys community food purchasing preferences and current spending leakage to surrounding towns' grocery stores, informing the eventual store's product mix to maximize the likelihood of capturing sufficient local spending to remain financially viable, a critical consideration given the documented high failure rate of rural grocery ventures that do not carefully match inventory to actual local demand. The project also develops a business plan and capital stack strategy combining member equity shares, a proposed USDA Rural Development business loan guarantee, and a local economic development authority contribution, positioning the cooperative to pursue construction and inventory financing in a subsequent funding phase once the feasibility and organizing work funded by this grant is complete. Community organizing meetings, held monthly throughout the project period, have already generated over 180 committed founding member households, demonstrating strong community demand and social capital that field research identifies as one of the strongest predictors of rural grocery cooperative sustainability. This project is structured as the essential predevelopment phase preceding a future capital request for store construction and initial inventory.",
    funderName: "USDA",
    agency: "USDA Rural Development — Rural Business Development Grant Program",
    awardAmount: 95000,
    fiscalYear: 2024,
    organization: "South Plains Community Grocers Cooperative",
    source: "USDA",
    sourceUrl: "https://www.rd.usda.gov/newsroom/news-release/usda-invests-tx-rbdg-2024-0288",
    category: ["rural_development", "food_access", "cooperative"],
  },
];

const ALL_PROPOSALS: SeedProposal[] = [
  ...NIH_PROPOSALS,
  ...HUD_PROPOSALS,
  ...DOJ_PROPOSALS,
  ...USDA_PROPOSALS,
];

function toRow(p: SeedProposal) {
  return {
    source: p.source,
    source_url: p.sourceUrl,
    funder_name: p.funderName,
    funder_type: p.agency,
    grant_program: p.title,
    award_amount: p.awardAmount,
    award_year: p.fiscalYear,
    category: p.category,
    full_text: `${p.title}\n\n${p.abstract}`,
    metadata: {
      organization: p.organization,
      agency: p.agency,
      fiscal_year: p.fiscalYear,
      seed: true,
    },
  };
}

function fatal(message: string): never {
  console.error(`\nFATAL: ${message}`);
  process.exit(1);
}

async function main() {
  let supabase: ReturnType<typeof createAdminClient>;
  try {
    supabase = createAdminClient();
  } catch (error) {
    fatal(error instanceof Error ? error.message : String(error));
  }

  console.log(`Seeding ${ALL_PROPOSALS.length} intelligence_funded_proposals records...\n`);

  const sourceUrls = ALL_PROPOSALS.map((p) => p.sourceUrl);
  const { data: existing, error: existingError } = await supabase
    .from("intelligence_funded_proposals")
    .select("source_url")
    .in("source_url", sourceUrls);

  if (existingError) {
    fatal(`dedup check failed: ${existingError.message}`);
  }

  const existingUrls = new Set(
    (existing ?? []).map((row: { source_url: string | null }) => row.source_url),
  );

  const newRows = ALL_PROPOSALS.filter((p) => !existingUrls.has(p.sourceUrl)).map(toRow);
  const skipped = ALL_PROPOSALS.length - newRows.length;

  if (newRows.length === 0) {
    console.log(`All ${ALL_PROPOSALS.length} seed records already exist (matched by source_url). Nothing to insert.`);
    return;
  }

  const { error: insertError } = await supabase
    .from("intelligence_funded_proposals")
    .insert(newRows as never);

  if (insertError) {
    fatal(`insert failed: ${insertError.message}`);
  }

  console.log(
    `Done. ${newRows.length} inserted, ${skipped} already present (skipped by source_url dedup check).`,
  );
}

main().catch((error) => {
  fatal(error instanceof Error ? error.message : String(error));
});
