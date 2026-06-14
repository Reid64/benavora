__BENAVORA__

Complete Feature Registry

All Built Features \+ Tier 6 Planned Features

June 13, 2026

# __1\. Core Platform \(Phase 1 MVP — 42/42 Prompts\)__

__\#__

__Feature__

__Description__

__Tier__

__Status__

1

__Authentication__

Email/password login and registration via Supabase Auth\. Creates org \+ profile on signup\.

MVP

BUILT

2

__Dashboard__

7 metric cards \(opportunities, submissions, drafts, deadlines, dollars requested/awarded, success rate\), opportunity feed, deadline widget, pipeline summary bar\.

MVP

BUILT

3

__Funder CRM__

Searchable/sortable funder database\. 12 category types\. Detail pages with tabs: Overview, Contacts, Opportunities, Applications, Notes\.

MVP

BUILT

4

__Contact CRM__

Contacts linked to funders\. Relationship status tracking \(cold/warm/active/champion\)\. Activity log\.

MVP

BUILT

5

__Opportunities__

Opportunity records with eligibility score, recommendation, keyword tags\. Filter by category, deadline, amount, status\.

MVP

BUILT

6

__Keyword Search__

Full\-text keyword search across opportunities via opportunity\_keywords table\. Add/remove tags per opportunity\.

MVP

BUILT

7

__Application Pipeline__

12\-stage kanban board with drag\-and\-drop\. Stage transition rules enforced\. Pipeline history logged\. Days\-in\-stage tracking\.

MVP

BUILT

8

__Document Repository__

Drag\-and\-drop file upload to Supabase Storage\. 8 document categories\. Expiration warnings\. Link docs to applications\.

MVP

BUILT

9

__Knowledge Base__

Organization profile editor, reusable narrative blocks with category tags, standard Q&A answers\. Proven narrative badges\.

MVP

BUILT

10

__AI Draft Generator__

Select opportunity \+ template type\. Claude generates draft using KB \+ proven narratives\. Confidence scoring 0\-100\. Warning banner below 70\.

MVP

BUILT

11

__Deadline System__

Calendar and list views\. Color\-coded urgency \(red/orange/yellow/green\)\. Auto\-created from opportunities\. Completion tracking\.

MVP

BUILT

12

__Notes System__

Polymorphic notes on funders, opportunities, and applications\. Timeline display\. Author tracking\.

MVP

BUILT

13

__Outcome Tracking__

Record awarded/denied/partial per application\. Funder feedback capture\. Narrative snapshot frozen at submission\.

MVP

BUILT

14

__Recursive Learning__

Analyzes awarded applications\. Extracts proven narratives\. Updates effectiveness scores\. Flags winning patterns for reuse in future drafts\.

MVP

BUILT

15

__Cold Outreach__

Extract contacts from companies without giving pages\. Outreach contact table with giving likelihood scores\. Convert to funder\.

MVP

BUILT

16

__Search Profiles__

Saved keyword configurations for automated searches\. Keywords, categories, geographic scope, amount range, active/paused toggle\.

MVP

BUILT

17

__Settings__

Organization settings\. User management with role assignment \(owner/admin/writer/viewer\)\. Feature flag display\.

MVP

BUILT

18

__RLS Isolation__

Row Level Security on all 24 tables\. Every query scoped by organization\_id\. Complete tenant data isolation\.

MVP

BUILT

# __2\. Tier 1 Enhancements \(4/4 Passed\)__

__\#__

__Feature__

__Description__

__Tier__

__Status__

19

__Draft Persistence__

Auto\-save drafts with version history\. Restore previous versions\. draft\_versions table with timestamps\.

Tier 1

BUILT

20

__Nav State Preservation__

Sidebar remembers active page on refresh\. Breadcrumb navigation\. Persistent UI state\.

Tier 1

BUILT

21

__KB Detail Views__

Expanded detail pages for narratives and answers\. Edit\-in\-place\. Category filtering\. Proven status display\.

Tier 1

BUILT

22

__AI Humanizer Agent__

Post\-processes all AI\-generated content to sound natural\. Removes robotic phrasing\. Applied to drafts, budgets, outreach emails\.

Tier 1

BUILT

# __3\. Tier 2 Enhancements \(7/7 Passed\)__

__\#__

__Feature__

__Description__

__Tier__

__Status__

23

__Grant Source Categorization__

Auto\-categorizes discovered opportunities by source type\. Tracks origin for analytics\.

Tier 2

BUILT

24

__Parallel Research Agents__

Multiple research agents run concurrently\. Results merged with deduplication\. Faster opportunity discovery\.

Tier 2

BUILT

25

__Search Profile Config__

Enhanced search profile UI with agent settings, execution scheduling, and result filtering\.

Tier 2

BUILT

26

__Analytics Dashboard__

Recharts\-powered visualizations\. Success rate by category, trend over time, dollars requested vs awarded, funder response times\.

Tier 2

BUILT

27

__Enhanced Eligibility__

Improved eligibility scoring with weighted criteria\. Geographic matching, budget alignment, mission similarity analysis\.

Tier 2

BUILT

28

__Alerts & Notifications__

In\-app notification center\. Deadline alerts, agent completion notices, submission confirmations\. Bell icon with badge count\.

Tier 2

BUILT

29

__Multi\-Model Consensus__

Sends critical evaluations to multiple AI models\. Compares responses\. Flags disagreements\. Higher confidence on eligibility and fit scores\.

Tier 2

BUILT

# __4\. Tier 3 Enhancements \(10/10 Passed\)__

__\#__

__Feature__

__Description__

__Tier__

__Status__

30

__Budget Narrative Generator__

AI generates line\-item budget breakdown \+ prose justification\. Personnel, supplies, equipment, travel, indirect costs\. Confidence scored\.

Tier 3

BUILT

31

__Document Assembly Engine__

Compares required vs attached documents\. Generates submission checklist\. Creates ZIP package for download\.

Tier 3

BUILT

32

__Funder Intelligence__

Scrapes funder websites to extract priorities, recent grants, review criteria, funding cycles\. Stored per funder\. 'Research Funder' button\.

Tier 3

BUILT

33

__Renewal Tracker__

Auto\-creates renewal records when recurring grants are awarded\. Tracks reporting deadlines, compliance status\. 60/30/14\-day alerts\.

Tier 3

BUILT

34

__Success Pattern Learning__

Compares winning vs rejected narratives for same funder category\. Identifies effective language patterns, structural elements, data points\.

Tier 3

BUILT

35

__Compliance Pre\-Check__

Validates applications before submission\. Checks required docs, \[NEEDS INPUT\] flags, word limits, org profile completeness\. Blocks submit if failing\.

Tier 3

BUILT

36

__Cold Outreach Sequences__

Pre\-built email drip templates\. Variable validation\. 24\-hour gaps enforced\. 50 emails/day cap\. Resend API integration\.

Tier 3

BUILT

37

__Grant Calendar View__

Monthly/weekly calendar grid with color\-coded deadline pills\. Filter by deadline type\. Mobile\-responsive list fallback\.

Tier 3

BUILT

38

__Email Parsing Agent__

AI classifies pasted emails: acknowledgment, award, rejection, info request\. Matches to funders\. Creates notes\. Flags for outcome recording\.

Tier 3

BUILT

39

__Board Report Generator__

Aggregates pipeline, submissions, awards, financials into professional PDF report\. Date range selection\. Organization branding\.

Tier 3

BUILT

# __5\. Tier 4 — Browser Automation \(7 Prompts\)__

__\#__

__Feature__

__Description__

__Tier__

__Status__

40

__Form Detection__

Playwright navigates to giving portal URLs\. AI identifies form fields and maps to application data\.

Tier 4

BUILT

41

__Auto\-Fill Engine__

Populates form fields with org profile, program data, and application content\. Field\-by\-field confidence scoring\.

Tier 4

BUILT

42

__Challenge Detection__

Detects CAPTCHAs, MFA prompts, account creation requirements\. Pauses session for human intervention\.

Tier 4

BUILT

43

__Approval Checkpoint__

Human approval step before final submission\. Shows filled form screenshot\. Approve/reject/edit\. Audit logged\.

Tier 4

BUILT

44

__Portal Credentials__

Stores portal login credentials per funder\. Auto\-login before form filling\. Credential vault with encryption\.

Tier 4

BUILT

45

__Submission Verification__

Captures confirmation page/number after submit\. Stores screenshots in Supabase Storage\. Links to application record\.

Tier 4

BUILT

46

__Automation Dashboard__

Session history with status indicators\. Failed session diagnostics\. Retry individual or batch\. Screenshot review\.

Tier 4

BUILT

# __6\. Tier 5 — SaaS Layer \(6 Prompts\)__

__\#__

__Feature__

__Description__

__Tier__

__Status__

47

__Stripe Billing__

Subscription management with 4 tiers\. Checkout, portal, webhooks\. Subscription status enforcement\.

Tier 5

BUILT

48

__Usage Limits__

Per\-tier caps: AI drafts/month, daily submissions, users, search profiles\. Enforced at API level\.

Tier 5

BUILT

49

__Onboarding Wizard__

7\-step guided setup: org profile, programs, board members, KB narratives, documents, search profile, review\. Progress saved per step\.

Tier 5

BUILT

50

__Audit Logs__

Tracks all user actions: logins, CRUD operations, agent runs, stage transitions, setting changes\. Searchable log viewer\.

Tier 5

BUILT

51

__User Invitations__

Invite users by email with role assignment\. Invitation acceptance flow\. Role management UI\.

Tier 5

BUILT

52

__Dark Mode UI__

Premium dark theme: deep navy\-black \#0a0a1a, blue\-to\-teal gradient accents, purple highlights\. Togglable in settings\.

Tier 5

BUILT

# __7\. Tier 6 — Full Autonomous Operation \(27 Prompts, PLANNED\)__

These features are fully specified in the v2 governance documents and queued for the next FORGE build\.

__\#__

__Feature__

__Description__

__Tier__

__Status__

53

__Grants\.gov Client__

Daily poll of federal grant opportunities via POST API\. No auth required\. Auto\-creates opportunity records with dedup\.

Tier 6

PLANNED

54

__SAM\.gov Client__

Weekly poll of federal contracts/grants\. Client provides free API key\. 1,000 req/day limit\.

Tier 6

PLANNED

55

__ProPublica 990 Mining__

Searches 1\.8M nonprofit tax filings\. Builds funder database from public IRS data\. No API key needed\.

Tier 6

PLANNED

56

__State Portal Framework__

Configurable scraping of 25\+ state grant portals\. Per\-state strategy config\. Independent failure isolation\.

Tier 6

PLANNED

57

__Integration Settings UI__

Settings page with cards for each connectable service\. Status, last sync, configure button\. SAM\.gov, 2Captcha, Candid, Gmail, Resend\.

Tier 6

PLANNED

58

__CSV Import Wizard__

Bulk import funders/prospects via CSV\. Column mapping UI\. Duplicate detection\. Preview before import\. Progress tracking\.

Tier 6

PLANNED

59

__Custom API Connector__

Client configures any JSON REST API\. Auth setup, field mapping, poll schedule\. Connect GrantWatch, Foundation Directory, etc\.

Tier 6

PLANNED

60

__Custom Scraping Targets__

Client assigns URLs for scheduled AI scraping\. Failure alerting\. Structure change detection\.

Tier 6

PLANNED

61

__Automation Queue__

Batch processing queue with priority scoring\. Background worker\. Sequential execution with configurable delays\.

Tier 6

PLANNED

62

__Semi/Autonomous Modes__

Semi\-auto: submits if all fields >90% confidence\. Autonomous: submits without pause\. Tier\-gated\.

Tier 6

PLANNED

63

__2Captcha Integration__

Solves reCAPTCHA, hCaptcha, image CAPTCHAs via 2Captcha API\. 3 retries then fallback to manual\. Client provides key\.

Tier 6

PLANNED

64

__Automation Monitor__

Real\-time queue status\. Failure categorization\. Retry controls\. Screenshot review\. Email alerts on failure\.

Tier 6

PLANNED

65

__Notification System__

Multi\-channel alerts \(in\-app \+ email\)\. Configurable per event type\. Digest options \(per\-event, hourly, daily\)\.

Tier 6

PLANNED

66

__990\-PF Giving History__

Extracts Schedule I from 990\-PF filings\. Builds per\-funder giving history: recipients, amounts, purposes, patterns\.

Tier 6

PLANNED

67

__Foundation Profile Builder__

Aggregates 990 data into funder profiles: avg grant size, total giving, geographic preferences, funding patterns\.

Tier 6

PLANNED

68

__Success Probability__

Combines eligibility, giving history, track record, deadline proximity, competition density\. Single percentage prediction\.

Tier 6

PLANNED

69

__Funder Relationship Score__

Dynamic score tracking interaction trajectory\. Events: outreach sent, response, application, award\. Momentum detection\.

Tier 6

PLANNED

70

__Competitor Intelligence__

Uses 990 data in reverse\. Tracks which orgs get funded by target funders\. Surfaces differentiation opportunities\.

Tier 6

PLANNED

71

__Deadline Prediction__

Historical pattern detection\. Predicts future posting/deadline dates from past cycles\. 60\-day advance projections\.

Tier 6

PLANNED

72

__Application Cloning__

Clone winning applications for similar funders\. AI adapts narrative for new funder requirements and priorities\.

Tier 6

PLANNED

73

__Semantic Funder Matching__

AI matches mission description against funder database using meaning, not just keywords\. Cross\-category discovery\.

Tier 6

PLANNED

74

__Follow\-Up Sequences__

Auto\-generated post\-submission actions: check\-in, thank\-you, feedback request, renewal prep\. Multi\-channel\.

Tier 6

PLANNED

75

__Financial Reconciliation__

Track requested vs awarded vs received vs spent\. Budget burn rate\. Grant\-specific expense categorization\.

Tier 6

PLANNED

76

__Compliance Calendar__

Track reporting requirements, spending restrictions, matching funds, regulatory filings\. Status dashboard\.

Tier 6

PLANNED

77

__Multi\-Channel Outreach__

Email, LinkedIn templates, phone scripts, physical mail templates\. Per\-channel analytics by funder category\.

Tier 6

PLANNED

78

__White\-Label Portal__

Consultant tier: custom branding, domain, master dashboard across all clients\. Client switching\. Aggregate analytics\.

Tier 6

PLANNED

# __8\. Summary__

__Category__

__Count__

__Status__

Phase 1 MVP Features

18

BUILT

Tier 1 Enhancements

4

BUILT

Tier 2 Enhancements

7

BUILT

Tier 3 Enhancements

10

BUILT

Tier 4 Browser Automation

7

BUILT

Tier 5 SaaS Layer

6

BUILT

Tier 6 Full Autonomous

26

PLANNED

__TOTAL FEATURES__

__78__

__52 BUILT / 26 PLANNED__

__Infrastructure__

__Count__

Database Tables

43 \(58 after Tier 6\)

AI Agents

14 \(29 after Tier 6\)

FORGE Prompts Executed

78 \(105 after Tier 6\)

RLS\-Protected Tables

100%

