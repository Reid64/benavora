**BENAVORA ENTERPRISE AGENTIC PROSPECT INTELLIGENCE LAYER**

Design and build within Benavora a complete, enterprise-grade, real-time
**Prospect Intelligence & Research Layer** composed of genuine
goal-oriented autonomous agents and deterministic supporting services.

This must not be implemented as a collection of prompts, scripts,
scheduled jobs, thin LLM wrappers, or single-purpose API calls described
as "agents."

The architecture must satisfy the following normative definition:

A component qualifies as an agent only when it can receive or maintain a
goal, create and revise a plan, select among permitted tools, execute or
delegate work within its authority, observe results, reason about those
results, and adapt its next action until the objective is satisfied,
blocked, paused, failed, or superseded.

ETL pipelines, crawlers, API clients, parsers, validators, schedulers,
databases, policy engines, entity-resolution algorithms, enrichment
workers, and workflow engines are deterministic services or tools and
must not be counted as agents unless they genuinely satisfy this
definition.

**1. Product Objective**

Create a standalone enterprise-class prospect-intelligence capability
inside Benavora\'s Research Layer capable of discovering, researching,
resolving, enriching, evaluating, connecting, monitoring, and
continuously updating:

-   Individual philanthropists

-   Major-donor prospects

-   Family foundations

-   Private foundations

-   Community foundations

-   Corporate foundations

-   Corporate giving programs

-   Corporate executives

-   Business owners

-   Board members

-   Trustees

-   Wealth holders

-   Community leaders

-   Institutional funders

-   Other legitimate fundraising prospects

The system should autonomously research permitted information across
sources including:

-   Open web

-   Public records

-   News

-   Nonprofit filings

-   IRS and Form 990 data

-   Corporate information

-   Foundation information

-   Public company information

-   Professional biographies

-   Public board memberships

-   Public charitable-giving information

-   Licensed databases

-   Authorized data providers

-   Permitted APIs

-   User-provided first-party information

-   CRM records

-   Internal Benavora data

-   Other lawful and policy-compliant sources

Every meaningful conclusion must be evidence-backed, attributable,
freshness-aware, confidence-scored, and reproducible.

**2. Architectural Requirement: One Agent Per Research Responsibility**

Do not create a single generalized "Prospect Research Agent."

Design separate specialized agents for materially different research
objectives so that context, reasoning quality, specialization,
evaluation criteria, and deliverable depth are not diluted.

Each agent must have:

-   Unique ID

-   Name

-   Agent family

-   Mission

-   Persistent or delegated objective

-   Inputs

-   Outputs

-   Permitted tools

-   Permitted data sources

-   Restricted data classes

-   Planning behavior

-   Observation behavior

-   Replanning behavior

-   Delegation permissions

-   Default autonomy level

-   Human boundary

-   Evidence requirements

-   Confidence requirements

-   Success criteria

-   Failure criteria

-   Escalation conditions

-   Memory scope

-   Cost/tool budget

-   Execution cadence

-   Evaluation suite

Do not artificially limit the number of agents.

Determine the appropriate agent registry from the actual responsibility
graph.

If an important research target, reasoning function, verification
function, strategic function, monitoring responsibility, or
quality-control function warrants its own specialist, create it.

**3. Required Research Deliverables**

Prospect dossiers should be capable of containing, when legitimately
available:

-   Verified identity

-   Biographical information

-   Geographic relevance

-   Employment history

-   Executive roles

-   Business ownership

-   Company affiliations

-   Education

-   Nonprofit board memberships

-   Foundation roles

-   Trustee relationships

-   Charitable-giving history

-   Known nonprofit affiliations

-   Cause interests

-   Mission affinity

-   Geographic giving preferences

-   Corporate philanthropy associations

-   Family-foundation connections

-   Wealth indicators

-   Liquidity indicators where legitimately inferable

-   Public business ownership indicators

-   Public securities/ownership indicators where applicable

-   Real-estate indicators where legally and appropriately sourced

-   Estimated philanthropic capacity

-   Contact information from permissible sources

-   Relationship pathways

-   Shared organizations

-   Shared professional connections

-   Shared nonprofit connections

-   Warm-introduction opportunities

-   Relevant news and trigger events

-   Funding opportunities

-   Recommended next research action

-   Source citations

-   Evidence quality

-   Confidence

-   Last verification date

The system may explain how publicly documented wealth appears to have
been accumulated, but must distinguish verified facts from reasoned
inference.

No inference may be presented as fact.

**4. Prospect Intelligence Graph**

Create a first-class graph model rather than relying exclusively on flat
CRM records.

The graph must support relationships such as:

**Person → Company → Foundation → Board → Nonprofit → Donation → Cause →
Geography → Relationship → Contact → Opportunity**

Additional entity and edge types should be introduced wherever
necessary.

Example:

**John Smith**\
→ owns **ABC Development**\
→ serves on the board of **XYZ Community Foundation**\
→ XYZ awarded **\$250,000 to housing organizations**\
→ ABC operates in **Texas**\
→ Smith has historically supported **homelessness-related
organizations**\
→ an organization board member has an identifiable professional
connection\
→ a plausible warm-introduction pathway exists\
→ Benavora creates and scores a fundraising opportunity.

The graph must preserve:

-   Source provenance

-   Edge provenance

-   Confidence

-   Temporal validity

-   Source freshness

-   Contradictions

-   Superseded facts

-   Entity-resolution history

-   Relationship strength

-   Relationship type

Agents must be capable of reasoning across multiple graph hops rather
than only retrieving isolated database fields.

**5. Natural-Language Prospect Discovery**

Build a natural-language research interface capable of accepting
requests such as:

Find Texas philanthropists who have supported affordable housing,
homelessness, recovery, reentry, or workforce development during the
last five years.

Or:

Find executives within 150 miles of Austin whose companies operate
corporate-giving programs and who personally serve on nonprofit boards.

The system must automatically translate natural language into a
structured research plan containing:

-   Intent

-   Entities

-   Geography

-   Time horizon

-   Cause taxonomy

-   Inclusion criteria

-   Exclusion criteria

-   Required evidence

-   Research depth

-   Candidate limits

-   Data-source plan

-   Agent assignments

-   Tool budgets

-   Confidence threshold

-   Ranking methodology

-   Stop conditions

The user should not need to manually build complex database filters.

**6. Mandatory Agent Families**

At minimum, evaluate the need for agents across the following families.

**Supervisory**

Include specialized agents such as:

-   Chief Prospect Intelligence Orchestrator

-   Research Strategy Architect

-   Cross-Agent Research Planner

-   Research Portfolio Allocator

-   Critic / Red-Team Agent

-   Recovery Investigator

-   Autonomy Governor

-   Executive Intelligence Narrative Agent

The supervisory layer owns persistent objectives and determines what
research should occur next.

It must be able to stop low-value research, reallocate effort, deepen
promising investigations, and terminate weak research paths.

**Discovery**

Potential specialist agents include:

-   Individual Prospect Discovery Agent

-   Major Donor Discovery Agent

-   Foundation Discovery Agent

-   Family Foundation Discovery Agent

-   Corporate Giving Discovery Agent

-   Executive Prospect Discovery Agent

-   Geographic Funding Discovery Agent

-   Cause-Aligned Prospect Discovery Agent

-   Hidden Prospect Discovery Agent

-   Existing-CRM Prospect Rediscovery Agent

**Prospect Intelligence**

Potential specialist agents include:

-   Individual Intelligence Agent

-   Employment Intelligence Agent

-   Business Ownership Intelligence Agent

-   Executive Intelligence Agent

-   Education Intelligence Agent

-   Nonprofit Board Intelligence Agent

-   Foundation Intelligence Agent

-   Corporate Philanthropy Intelligence Agent

-   Giving History Intelligence Agent

-   Wealth Indicator Intelligence Agent

-   Liquidity Event Intelligence Agent

-   Geographic Intelligence Agent

-   Contact Intelligence Agent

-   Cause Interest Intelligence Agent

-   News & Trigger Intelligence Agent

**Relationship Intelligence**

Create independent specialists for functions such as:

-   Relationship Discovery

-   Board Relationship Mapping

-   Corporate Relationship Mapping

-   Foundation Relationship Mapping

-   Professional Connection Mapping

-   Organizational Overlap Analysis

-   Warm Introduction Pathfinding

-   Relationship Strength Evaluation

**Qualification**

Include agents capable of independently determining:

-   Mission Affinity

-   Funding Eligibility

-   Giving Capacity

-   Philanthropic Propensity

-   Relationship Strength

-   Geographic Relevance

-   Timing/Readiness

-   Opportunity Strength

-   Research Sufficiency

-   Disqualification

**Strategy**

Potential agents should include:

-   Prospect Engagement Strategy Agent

-   Best First Ask Agent

-   Cultivation Strategy Agent

-   Foundation Approach Strategy Agent

-   Corporate Partnership Strategy Agent

-   Warm Introduction Strategy Agent

-   Opportunity Sequencing Agent

-   Next-Best-Action Agent

**Knowledge Integrity**

At minimum evaluate:

-   Entity Resolution Agent

-   Entity Graph Agent

-   Evidence Research Agent

-   Provenance Verification Agent

-   Contradiction Investigator

-   Source Freshness Agent

-   Knowledge Curator

-   Data Quality Agent

-   Duplicate Identity Investigator

-   Research Critic

**7. True Agentic Execution**

Every genuine agent must implement a closed reasoning/execution loop:

**GOAL\
→ OBSERVE CURRENT STATE\
→ PLAN\
→ SELECT TOOLS / DELEGATE\
→ EXECUTE\
→ COLLECT EVIDENCE\
→ EVALUATE\
→ OBSERVE RESULT\
→ REVISE PLAN\
→ CONTINUE / ESCALATE / STOP**

An agent must not terminate simply because one tool call returned data.

It should determine whether:

-   sufficient evidence exists

-   additional sources are required

-   contradictory evidence exists

-   another specialist should be delegated

-   entity identity remains uncertain

-   confidence is too low

-   research value is declining

-   the prospect should be qualified

-   the prospect should be disqualified

-   a human decision is needed

**8. Typed Agent Delegation**

All agent-to-agent work must use a typed DelegatedTask.

Minimum schema:

task_id

parent_agent

child_agent

objective

constraints

context_refs

allowed_tools

allowed_data_classes

prohibited_data_classes

evidence_budget

tool_budget

token_budget

financial_budget

deadline

freshness_requirement

minimum_confidence

success_criteria

stop_conditions

escalation_conditions

max_autonomy

Rules:

-   A child cannot exceed the parent\'s authority.

-   A child cannot rewrite the parent\'s objective.

-   Delegation must be traceable.

-   Delegation must be cancellable.

-   Default delegation depth should be bounded.

-   Fan-out must be budget controlled.

-   Recursive delegation must terminate.

-   Agents cannot approve their own authority increases.

-   Agents cannot approve their own policy exceptions.

-   Agents cannot independently validate consequential conclusions they
    originated when independent review is required.

**9. Autonomy Model**

Use the following autonomy architecture:

**A0 --- Observe Only**\
No operational activity.

**A1 --- Research & Recommend**\
Research, reason, analyze, and recommend.

**A2 --- Prepare & Queue**\
Create dossiers, briefs, analyses, tasks, drafts, and proposed
workflows.

**A3 --- Autonomous Reversible Execution**\
Execute pre-authorized, low-risk, reversible operations.

**A4 --- Policy-Bounded Autonomous Execution**\
Execute higher-impact actions only within explicit tenant policy and
durable workflow.

Human boundaries should be modeled separately:

**H1 --- Human Approval Required**

**H2 --- Human Execution Required**

Agents may never increase their own autonomy.

**10. Persistent Goal Lifecycle**

Implement durable prospect-intelligence goals using states such as:

PROPOSED

VALIDATED

ACTIVE

PLANNING

RESEARCHING

EXECUTING

OBSERVING

REPLANNING

QUALIFIED

DISQUALIFIED

ENGAGEMENT_READY

CULTIVATION

AWAITING_RESPONSE

MONITORING

RESEARCH_STALE

BLOCKED_POLICY

BLOCKED_HUMAN

FAILED_RECOVERABLE

FAILED_TERMINAL

SATISFIED

PAUSED

REOPENED

Persistent objectives must survive process restarts and model sessions.

**11. Evidence and Provenance**

Every consequential researched assertion must support fields equivalent
to:

claim_id

entity_id

claim

value

claim_type

source_url

source_title

source_type

publisher

retrieved_at

published_at

last_verified_at

evidence_excerpt

agent_id

research_run_id

confidence

verification_status

freshness_status

inference_status

contradiction_status

lineage

Distinguish explicitly among:

-   VERIFIED FACT

-   CORROBORATED FACT

-   SINGLE-SOURCE FACT

-   REASONED INFERENCE

-   ESTIMATE

-   UNVERIFIED

-   CONTRADICTED

-   STALE

No unsupported factual claim should silently enter the canonical
prospect profile.

**12. Independent Criticism**

High-value or consequential prospect conclusions must be reviewed by an
independent critic operating with separate context.

The critic may reject research for:

-   Insufficient evidence

-   Entity confusion

-   Unsupported wealth conclusions

-   Unsupported giving conclusions

-   Stale evidence

-   Weak source quality

-   Incorrect relationship inference

-   Duplicate identities

-   Unsupported causation

-   Improper data use

-   Policy concerns

A research-producing agent cannot certify its own high-impact
conclusions.

**13. Deterministic Supporting Services**

Do not represent deterministic infrastructure as agents.

Architect appropriate services including:

-   Identity/Auth

-   Tenant isolation

-   RBAC/ABAC

-   Policy Enforcement

-   Consent Ledger

-   Durable Workflow Orchestration

-   Transactional Outbox/Event Bus

-   Connector Gateway

-   API Gateway

-   Browser Automation Broker

-   HTTP/Web Crawler

-   Document Retrieval

-   Document Parsing

-   Form 990 Parser

-   SEC/EDGAR Adapter

-   Public Records Adapter

-   Licensed Data Provider Adapters

-   Search Provider Adapter

-   CRM Connectors

-   Contact Normalization

-   Entity Resolution Support Engine

-   Deduplication Engine

-   Knowledge Graph Store

-   Evidence/Provenance Ledger

-   Audit Ledger

-   Source Snapshot Service

-   Rate Limiter

-   Cost Ledger

-   Model Gateway

-   Notification Service

-   Feature Flags

-   Kill Switches

-   Observability

-   Evaluation Infrastructure

Use deterministic logic wherever deterministic enforcement is safer and
more reliable than probabilistic model reasoning.

**14. CRM Relationship**

The Prospect Intelligence Layer is **not itself the CRM**.

It is an intelligence system capable of synchronizing enriched prospect
intelligence into Benavora\'s CRM or external CRMs through controlled
connectors.

Maintain separation among:

**Research truth**\
**Canonical entity truth**\
**Opportunity intelligence**\
**CRM operational state**

Do not allow CRM fields to become the only knowledge store.

**15. Continuous Intelligence**

Prospect profiles must not become static snapshots.

Design continuous or event-triggered monitoring for meaningful
developments such as:

-   Company sale

-   Acquisition

-   IPO

-   Executive appointment

-   Retirement

-   Foundation appointment

-   Board appointment

-   New nonprofit affiliation

-   Major public charitable gift

-   New foundation filing

-   Corporate giving program launch

-   Geographic expansion

-   Significant public business event

-   Relevant philanthropic announcement

The system should decide whether a trigger materially changes:

-   Capacity

-   Affinity

-   Timing

-   Relationship strength

-   Opportunity priority

-   Recommended next action

**16. Research Economics**

Agents must reason about the marginal value of additional research.

Example:

We have identified 370 prospects. Forty-two now have sufficiently strong
evidence. Additional broad research has low marginal value. Suspend deep
research on the remaining pool and allocate the next research budget to
relationship discovery for the top fifteen opportunities.

This ability to stop, redirect, deepen, reprioritize, and replan work is
mandatory.

**17. Success Criteria**

Every agent and workflow must measure:

**Outcome Success**

Did the research improve the quality or probability of the fundraising
opportunity?

**Operational Success**

Was the objective completed and validated?

**Quality Success**

Did evidence, factuality, provenance, policy, privacy, and confidence
requirements pass?

**Efficiency Success**

Was the result achieved within approved model, token, API, time, and
monetary budgets?

**Learning Success**

Did the outcome improve future prospect discovery, research,
qualification, or strategy?

**Evidence Success**

Can every consequential conclusion be reconstructed from attributable
evidence?

**18. Learning Architecture**

Build controlled learning from research outcomes.

The system should learn from:

-   Successful prospect identification

-   False positives

-   Disqualifications

-   Human corrections

-   Response rates

-   Meeting acceptance

-   Introduction success

-   Grant outcomes

-   Donation outcomes

-   Incorrect identity resolution

-   Incorrect capacity estimates

-   Incorrect affinity predictions

-   Research paths that produced little value

-   Sources that repeatedly produced strong evidence

Learning must update strategy and retrieval behavior without silently
modifying governing policy, security boundaries, canonical facts, or
autonomy permissions.

**19. Privacy, Compliance and Ethical Research**

Engineer explicit controls around:

-   Sensitive personal data

-   Data minimization

-   Source permissibility

-   Terms of service

-   Robots/access restrictions

-   Licensed-data limitations

-   Identity linkage

-   Contact information

-   Retention

-   Auditability

-   Tenant isolation

-   Human review

-   Automated outreach

-   Data subject concerns

Do not infer or target protected or highly sensitive personal
characteristics for fundraising solicitation.

Public availability alone must not automatically constitute unrestricted
permissible use.

**20. Enterprise Engineering Standard**

Build this as a production-grade multi-tenant SaaS subsystem.

Architecture must include:

-   Strong tenant isolation

-   Durable workflows

-   Idempotency

-   Exactly-once or effectively-once semantics where required

-   Retries

-   Backoff

-   Dead-letter handling

-   Compensation workflows

-   Concurrency controls

-   Rate limits

-   Circuit breakers

-   Source caching

-   Model routing

-   Context management

-   Token budgeting

-   API-cost budgeting

-   Structured outputs

-   Schema validation

-   Provenance

-   Complete audit trails

-   Observability

-   Metrics

-   Distributed tracing

-   Failure recovery

-   Kill switches

-   Feature flags

-   Versioned prompts/policies

-   Evaluation harnesses

-   Regression testing

-   Security testing

-   Load testing

-   Chaos/recovery testing

No architecture decision should assume that a single worker, model
session, server, or process remains continuously alive.

**21. Required Engineering Deliverables**

Do not stop with conceptual descriptions.

Produce implementation-ready artifacts including:

1.  Complete architecture specification

2.  Agent registry

3.  Deterministic service registry

4.  Agent behavioral contracts

5.  Tool contracts

6.  Delegation schemas

7.  Goal schemas

8.  Prospect entity schema

9.  Knowledge graph schema

10. Relationship/edge schema

11. Evidence/provenance schema

12. Opportunity schema

13. Research-run schema

14. Agent-memory architecture

15. Autonomy architecture

16. Policy architecture

17. Workflow/state-machine definitions

18. Event taxonomy

19. API contracts

20. Database schema

21. Multi-tenant isolation architecture

22. Research-source registry

23. Tool/provider registry

24. Cost-control architecture

25. Evaluation framework

26. Agent-specific evaluation suites

27. Observability design

28. Failure/recovery design

29. Security model

30. Privacy controls

31. Human-in-the-loop interfaces

32. Operator Command Center requirements

33. Prospect Intelligence dashboard requirements

34. Natural-language search interface

35. Prospect dossier UI

36. Relationship graph UI

37. Source/evidence inspection UI

38. Opportunity-ranking UI

39. Research queue UI

40. Agent activity/audit UI

41. Implementation roadmap

42. Dependency graph

43. Development queue

44. Test strategy

45. Production-readiness gates

**22. Implementation Directive**

Approach this as a principal engineer, enterprise AI architect,
distributed-systems architect, data architect, security architect,
fundraising-technology architect, agentic-systems engineer, and product
architect working together.

Do not optimize for minimum implementation effort.

Optimize for:

-   Correct architecture

-   Genuine autonomy

-   Research depth

-   Evidence integrity

-   Reliability

-   Scalability

-   Security

-   Explainability

-   Auditability

-   Maintainability

-   Extensibility

-   Operational control

Do not label ordinary automation as agentic.

Do not combine materially different research responsibilities merely to
reduce agent count.

Do not create hundreds of trivial agents simply to inflate agent count.

The division of responsibilities must be justified by reasoning
boundaries, context isolation, specialized tools, specialized evaluation
criteria, or distinct persistent objectives.

The completed Benavora Prospect Intelligence Layer should be capable of
functioning as a serious enterprise prospect-intelligence platform in
its own right while simultaneously feeding the broader Benavora
fundraising system.

Its operating model should be:

**DISCOVER\
→ RESOLVE\
→ RESEARCH\
→ VERIFY\
→ CONNECT\
→ REASON\
→ QUALIFY\
→ PRIORITIZE\
→ STRATEGIZE\
→ SYNCHRONIZE\
→ MONITOR\
→ OBSERVE OUTCOMES\
→ LEARN\
→ REPLAN**

The final implementation must demonstrate, through architecture and
executable behavior rather than terminology, that the system contains
genuinely autonomous, evidence-driven, goal-oriented agents. Keep the
core agent contracts reasonably generic, isolate provider access behind
adapters, preserve evidence/provenance independently from CRM state, and
keep tenant boundaries clean

**BENAVORA PROSPECT INTELLIGENCE LAYER**

**Complete 44-Agent Registry**

This registry defines the recommended initial production fleet for
Benavora\'s enterprise Prospect Intelligence Layer.

Every component below qualifies as an agent only if it can:

-   Receive or maintain a goal

-   Observe relevant current state

-   Form an execution plan

-   Select among permitted tools

-   Delegate where appropriate

-   Evaluate retrieved evidence

-   Revise its plan

-   Continue, stop, escalate, or reallocate work based on results

-   Preserve state across durable workflows

-   Produce auditable outputs

Mechanical crawling, parsing, API access, scheduling, entity matching,
graph storage, policy enforcement, CRM synchronization, evidence
persistence, and similar functions remain deterministic services.

**FAMILY 1 --- SUPERVISORY & ORCHESTRATION**

**BEN-SUP-01 --- Chief Prospect Intelligence Orchestrator**

**Mission:**\
Own the persistent prospect-intelligence objective for each tenant and
coordinate the entire research fleet.

**Responsibilities:**

-   Receive high-level fundraising research goals

-   Convert them into persistent intelligence objectives

-   Observe candidate inventory and research state

-   Determine which prospects deserve additional research

-   Delegate work to specialist agents

-   Reallocate research budget dynamically

-   Suspend low-value investigations

-   Reopen prospects when new evidence appears

-   Determine when sufficient research exists

-   Coordinate qualification and strategy agents

-   Maintain global progress toward the research objective

**Primary inputs:**

-   User objectives

-   Tenant digital twin

-   Prospect graph

-   Opportunity store

-   Research state

-   Agent performance

-   Cost ledger

**Primary outputs:**

-   Active research portfolios

-   DelegatedTasks

-   Priority changes

-   Stop/research-more decisions

-   Escalations

-   Final intelligence packages

**Default autonomy:** A4\
**Human boundary:** Strategic changes outside tenant policy\
**Cadence:** Continuous

**BEN-SUP-02 --- Research Strategy Architect**

**Mission:**\
Transform broad fundraising objectives into evidence-driven
prospect-research strategies.

**Responsibilities:**

-   Interpret fundraising objectives

-   Define target populations

-   Determine geographic scope

-   Define cause alignment requirements

-   Establish research depth

-   Determine evidence requirements

-   Select appropriate research families

-   Establish research phases and stopping criteria

-   Construct rolling research strategies

**Example objective:**

"Find high-capacity Texas prospects aligned with affordable housing."

The agent converts this into:

-   Geography

-   Prospect classes

-   Cause taxonomy

-   Time range

-   Evidence requirements

-   Capacity thresholds

-   Relationship requirements

-   Search strategy

-   Qualification gates

**Default autonomy:** A2\
**Human boundary:** Fundamental fundraising strategy changes\
**Cadence:** On demand + periodic review

**BEN-SUP-03 --- Cross-Agent Research Planner**

**Mission:**\
Convert research strategy into dependency-aware multi-agent execution
plans.

**Responsibilities:**

-   Decompose objectives

-   Identify parallelizable work

-   Establish dependencies

-   Select specialist agents

-   Assign budgets

-   Define success criteria

-   Determine execution order

-   Manage bounded recursion

-   Prevent redundant research

**Example:**

Parallel branch:

Individual Intelligence\
Foundation Intelligence\
Board Intelligence\
Giving Intelligence\
Business Intelligence

Then:

Entity reconciliation\
Affinity analysis\
Relationship analysis\
Qualification

**Default autonomy:** A4\
**Human boundary:** Workflows requiring actions beyond research
authority\
**Cadence:** Per objective / replan

**BEN-SUP-04 --- Research Portfolio Allocator**

**Mission:**\
Allocate research resources toward prospects with the highest expected
fundraising intelligence value.

**Responsibilities:**

-   Compare candidate prospects

-   Estimate marginal research value

-   Balance depth vs breadth

-   Allocate model/API/tool budgets

-   Suspend low-value candidates

-   Increase research depth on promising prospects

-   Prevent unlimited investigation

-   Reprioritize portfolios when evidence changes

**Core reasoning question:**

"Where will another dollar or minute of research generate the most
useful fundraising intelligence?"

**Default autonomy:** A3\
**Human boundary:** Budget increases beyond tenant limits\
**Cadence:** Continuous/daily

**BEN-SUP-05 --- Prospect Research Critic & Red-Team Agent**

**Mission:**\
Independently challenge consequential research findings before they
become trusted intelligence.

**Responsibilities:**

-   Challenge unsupported claims

-   Detect weak evidence

-   Identify entity confusion

-   Challenge wealth estimates

-   Challenge charitable-giving assumptions

-   Detect circular sourcing

-   Detect stale data

-   Challenge inferred relationships

-   Require additional research when necessary

-   Issue blocking findings

**Possible outputs:**

PASS\
PASS_WITH_CAVEATS\
RESEARCH_MORE\
BLOCK_INSUFFICIENT_EVIDENCE\
BLOCK_ENTITY_AMBIGUITY\
BLOCK_POLICY

**Default autonomy:** A2\
**Human boundary:** Cannot override policy or certify its own prior
work\
**Cadence:** Per consequential dossier

**BEN-SUP-06 --- Research Recovery Investigator**

**Mission:**\
Diagnose failed, incomplete, contradictory, or corrupted research
workflows and determine the safest recovery path.

**Responsibilities:**

-   Investigate failed workflows

-   Detect abandoned tasks

-   Diagnose connector failures

-   Resolve partial research runs

-   Recover from duplicate execution

-   Detect graph corruption

-   Determine whether research can resume

-   Recommend rollback or re-execution

-   Preserve evidence already obtained safely

**Default autonomy:** A3\
**Human boundary:** Irreversible destructive recovery\
**Cadence:** Event-driven

**FAMILY 2 --- DISCOVERY**

**BEN-DIS-01 --- Individual Prospect Discovery Agent**

**Mission:**\
Discover individual philanthropic prospects matching tenant-defined
fundraising objectives.

**Research dimensions:**

-   Geography

-   Cause alignment

-   Professional position

-   Charitable history

-   Public influence

-   Business ownership

-   Community participation

-   Existing organizational overlap

**Output:**\
Ranked candidate individuals with preliminary evidence and research
justification.

**Default autonomy:** A2\
**Cadence:** Continuous/on demand

**BEN-DIS-02 --- Major Donor Discovery Agent**

**Mission:**\
Identify individuals with evidence suggesting capacity and propensity
for significant philanthropic giving.

**Responsibilities:**

-   Search public charitable history

-   Evaluate prior gift magnitude

-   Identify foundation relationships

-   Identify major philanthropic commitments

-   Detect major-gift patterns

-   Identify candidates warranting deep capacity research

**Important rule:**\
Wealth alone does not establish donor propensity.

**Default autonomy:** A2

**BEN-DIS-03 --- Foundation Discovery Agent**

**Mission:**\
Discover private, family, corporate, and community foundations aligned
with tenant programs.

**Responsibilities:**

-   Search foundation filings

-   Analyze stated priorities

-   Examine historical grants

-   Identify geographic limitations

-   Detect program alignment

-   Identify application pathways

-   Identify trustees and officers

**Default autonomy:** A2

**BEN-DIS-04 --- Corporate Giving Discovery Agent**

**Mission:**\
Identify companies with relevant charitable-giving, sponsorship,
employee-giving, or community-investment programs.

**Responsibilities:**

-   Find corporate foundations

-   Corporate grants

-   Community giving

-   Sponsorship programs

-   Matching gifts

-   Employee giving

-   Volunteer grants

-   Local community investment

**Output:**\
Corporate opportunity candidates plus eligibility rationale.

**Default autonomy:** A2

**BEN-DIS-05 --- Executive Prospect Discovery Agent**

**Mission:**\
Identify executives, founders, owners, and senior decision-makers who
may have philanthropic relevance.

**Responsibilities:**

-   Identify senior leadership

-   Associate executives with companies

-   Identify charitable affiliations

-   Determine nonprofit-board involvement

-   Determine relevance to giving programs

-   Surface executive/foundation overlaps

**Default autonomy:** A2

**BEN-DIS-06 --- Geographic Funding Discovery Agent**

**Mission:**\
Discover prospects based on geographic relevance.

**Examples:**

-   Texas philanthropists

-   Austin-area executives

-   Foundations funding Williamson County

-   Companies giving within 150 miles of a location

**Responsibilities:**

-   Interpret geographic constraints

-   Analyze regional giving

-   Map operating footprints

-   Identify local foundations

-   Identify regional decision-makers

**Default autonomy:** A2

**BEN-DIS-07 --- Cause-Aligned Prospect Discovery Agent**

**Mission:**\
Discover prospects whose documented charitable interests align with the
tenant\'s mission.

**Cause dimensions may include:**

-   Affordable housing

-   Homelessness

-   Recovery

-   Reentry

-   Workforce development

-   Education

-   Veterans

-   Community development

-   Poverty reduction

**Output:**\
Prospects with evidence-supported mission alignment.

**Default autonomy:** A2

**BEN-DIS-08 --- Hidden Prospect & CRM Rediscovery Agent**

**Mission:**\
Identify overlooked high-potential prospects already present within
first-party organizational data.

**Example:**

Existing \$100 donor\
→ owns significant company\
→ serves on foundation board\
→ previously gave substantially elsewhere\
→ deserves major-donor review.

**Responsibilities:**

-   Examine existing CRM

-   Detect underestimated donors

-   Find organizational relationships

-   Reclassify prospects when new evidence emerges

-   Surface dormant opportunities

**Default autonomy:** A2\
**Human boundary:** No automatic solicitation escalation

**FAMILY 3 --- CORE PROSPECT INTELLIGENCE**

**BEN-INT-01 --- Individual Intelligence Agent**

**Mission:**\
Build the canonical evidence-backed biographical intelligence profile
for an individual prospect.

**Research areas:**

-   Identity

-   Geography

-   Career

-   Current roles

-   Previous roles

-   Public biography

-   Community participation

-   Philanthropic activities

**Default autonomy:** A2

**BEN-INT-02 --- Employment & Career Intelligence Agent**

**Mission:**\
Reconstruct the prospect\'s relevant professional history.

**Responsibilities:**

-   Current employer

-   Historical employers

-   Seniority

-   Executive positions

-   Founder roles

-   Career transitions

-   Industry experience

-   Major professional events

**Output:**\
Time-aware professional chronology.

**Default autonomy:** A2

**BEN-INT-03 --- Business Ownership Intelligence Agent**

**Mission:**\
Investigate documented ownership, founder, partnership, and significant
business relationships.

**Responsibilities:**

-   Company ownership

-   Founder status

-   Private companies

-   Public ownership where documented

-   Acquisition events

-   Company sales

-   Major business affiliations

**Default autonomy:** A2

**BEN-INT-04 --- Education & Alumni Intelligence Agent**

**Mission:**\
Research educational affiliations relevant to relationship discovery or
philanthropic behavior.

**Responsibilities:**

-   Universities

-   Professional schools

-   Alumni associations

-   Educational board involvement

-   Known institutional giving where documented

-   Shared alumni relationships

**Default autonomy:** A2

**BEN-INT-05 --- Nonprofit Board Intelligence Agent**

**Mission:**\
Identify and verify nonprofit board memberships and leadership roles.

**Responsibilities:**

-   Current board positions

-   Historical board positions

-   Officer roles

-   Trustee roles

-   Committee involvement

-   Board overlap with target organizations

**Primary evidence preference:**

-   Nonprofit website

-   Form 990

-   Official biography

-   Authoritative filing

**Default autonomy:** A2

**BEN-INT-06 --- Foundation Intelligence Agent**

**Mission:**\
Develop detailed intelligence on foundations associated with prospects.

**Responsibilities:**

-   Foundation assets

-   Officers

-   Directors

-   Trustees

-   Grant history

-   Geographic priorities

-   Cause priorities

-   Recipient history

-   Giving trends

-   Application practices

-   Prospect relationship

**Default autonomy:** A2

**BEN-INT-07 --- Giving History Intelligence Agent**

**Mission:**\
Reconstruct documented charitable-giving behavior.

**Responsibilities:**

-   Known donations

-   Foundation grants

-   Public philanthropic commitments

-   Donation magnitude

-   Recipient organizations

-   Causes

-   Geographic patterns

-   Frequency

-   Recency

**Critical distinction:**

Documented giving must remain separate from estimated giving.

**Default autonomy:** A2

**BEN-INT-08 --- Wealth & Capacity Intelligence Agent**

**Mission:**\
Evaluate evidence relevant to philanthropic capacity without treating
estimated net worth as confirmed giving ability.

**Potential indicators:**

-   Business ownership

-   Company exits

-   Public equity

-   Executive compensation

-   Foundation assets

-   Public real-estate indicators

-   Major liquidity events

-   Historical charitable gifts

-   Public asset-related information

**Required outputs:**

-   Evidence

-   Confidence

-   Estimated capacity range

-   Major uncertainties

-   Distinction among:

    -   wealth

    -   liquidity

    -   philanthropic capacity

    -   propensity

**Default autonomy:** A2\
**Human boundary:** Sensitive/high-impact capacity determinations

**BEN-INT-09 --- Wealth Origin & Liquidity Event Agent**

**Mission:**\
Explain, with citations, the documented mechanisms through which
substantial wealth or liquidity appears to have arisen.

**Example:**

Company founder\
→ business expansion\
→ acquisition\
→ documented sale\
→ subsequent foundation creation.

**Responsibilities:**

-   Company sales

-   IPO events

-   acquisitions

-   equity events

-   major exits

-   documented inheritance where legitimately public

-   other material liquidity events

**Output labels:**

VERIFIED\
INFERRED\
UNKNOWN

**Default autonomy:** A2

**BEN-INT-10 --- Contact Intelligence Agent**

**Mission:**\
Identify permissible and relevant contact pathways.

**Responsibilities:**

-   Public professional email

-   Organization contact channels

-   Foundation contact channels

-   Corporate giving contacts

-   Public office contact

-   CRM-known contacts

-   Appropriate introduction routes

**Restrictions:**

-   No prohibited data brokerage

-   No inappropriate private contact harvesting

-   Observe source and provider permissions

**Default autonomy:** A2

**FAMILY 4 --- RELATIONSHIP & GRAPH INTELLIGENCE**

**BEN-REL-01 --- Relationship Discovery Agent**

**Mission:**\
Discover documented relationships between prospects and relevant people
or organizations.

**Relationship types:**

-   Employment

-   Board membership

-   Foundation

-   Business

-   Professional association

-   Alumni

-   Nonprofit

-   Community organization

**Default autonomy:** A2

**BEN-REL-02 --- Board Relationship Mapping Agent**

**Mission:**\
Analyze board and trustee networks for introduction opportunities.

**Example:**

Prospect\
→ Foundation board\
→ Trustee\
→ Local nonprofit\
→ Existing Benavora contact.

**Default autonomy:** A2

**BEN-REL-03 --- Corporate Relationship Mapping Agent**

**Mission:**\
Identify relationships connecting the tenant to corporations and
decision-makers.

**Responsibilities:**

-   Existing vendors

-   Employees

-   executives

-   suppliers

-   partners

-   customers where authorized

-   corporate philanthropy personnel

-   shared organizations

**Default autonomy:** A2

**BEN-REL-04 --- Organizational Overlap Agent**

**Mission:**\
Identify shared organizational memberships among prospects and
tenant-connected individuals.

**Examples:**

-   Same nonprofit board

-   Same university

-   Same chamber

-   Same professional association

-   Same foundation

-   Same company

-   Same community organization

**Default autonomy:** A2

**BEN-REL-05 --- Warm Introduction Pathfinding Agent**

**Mission:**\
Find the strongest evidence-backed introduction path between the
organization and a prospect.

**Graph output example:**

Faith Foundation\
→ Board Member\
→ Employer\
→ Executive\
→ Foundation Trustee\
→ Prospect

Each path should include:

-   Hop count

-   Relationship evidence

-   Confidence

-   Relationship strength

-   Freshness

-   Recommended introducer

-   Friction estimate

-   Alternative paths

**Default autonomy:** A2

**BEN-REL-06 --- Relationship Strength Agent**

**Mission:**\
Evaluate the practical strength and usefulness of identified
relationship paths.

**Factors:**

-   Direct vs indirect

-   Current vs historical

-   Professional vs nominal

-   Evidence strength

-   Relationship frequency where known

-   Shared organizations

-   Recency

-   Number of hops

**Output:**

VERY_STRONG\
STRONG\
MODERATE\
WEAK\
SPECULATIVE

**Default autonomy:** A2

**FAMILY 5 --- QUALIFICATION & DECISION INTELLIGENCE**

**BEN-QLF-01 --- Mission Affinity Agent**

**Mission:**\
Determine how strongly documented philanthropic behavior aligns with the
tenant mission.

**Factors:**

-   Prior gifts

-   Foundation grants

-   Board memberships

-   Public philanthropic statements

-   Relevant corporate programs

-   Geographic relevance

-   Cause similarity

**Must produce:**

-   Score

-   Evidence

-   Explanation

-   Confidence

-   Contradictions

**Default autonomy:** A2

**BEN-QLF-02 --- Funding Eligibility Agent**

**Mission:**\
Determine whether a foundation, corporation, or funding program is
actually available to the tenant.

**Checks:**

-   501(c)(3) requirements

-   Geography

-   Program eligibility

-   Organization type

-   Grant size

-   Deadlines

-   Invitation requirements

-   Excluded causes

-   Prior recipients

**Default autonomy:** A2

**BEN-QLF-03 --- Philanthropic Capacity & Propensity Agent**

**Mission:**\
Combine capacity and behavior evidence without conflating them.

**Dimensions:**

-   Capacity

-   Giving history

-   Recency

-   Frequency

-   Cause relevance

-   Typical gift scale

-   Foundation access

-   Relationship strength

**Output:**\
Evidence-backed likelihood and potential range rather than unsupported
certainty.

**Default autonomy:** A2

**BEN-QLF-04 --- Opportunity Qualification Agent**

**Mission:**\
Integrate research into a defensible fundraising-opportunity
classification.

**Possible classifications:**

TIER_1_PRIORITY\
TIER_2_CULTIVATE\
TIER_3_MONITOR\
RESEARCH_MORE\
LOW_PROBABILITY\
INELIGIBLE\
DISQUALIFIED

**Responsibilities:**

-   Aggregate specialist findings

-   Inspect evidence quality

-   Identify missing research

-   Compare prospect to tenant objectives

-   Determine whether strategic work should begin

**Default autonomy:** A3

**BEN-QLF-05 --- Timing & Readiness Agent**

**Mission:**\
Determine whether the opportunity should be approached now, cultivated
first, monitored, or deferred.

**Signals:**

-   Recent gift

-   Foundation cycle

-   New board appointment

-   Corporate expansion

-   Liquidity event

-   New CSR initiative

-   Leadership transition

-   Existing relationship

-   Grant deadline

-   Prospect engagement state

**Default autonomy:** A2

**FAMILY 6 --- STRATEGY & NEXT-BEST ACTION**

**BEN-STR-01 --- Prospect Engagement Strategy Agent**

**Mission:**\
Determine the most appropriate evidence-based engagement strategy for a
qualified prospect.

**Possible strategies:**

-   Warm introduction

-   Direct introduction

-   Cultivation

-   Event invitation

-   Information sharing

-   Corporate partnership inquiry

-   Foundation application

-   Sponsorship proposal

-   Relationship development

**Default autonomy:** A2

**BEN-STR-02 --- Best First Ask Agent**

**Mission:**\
Recommend an appropriate initial ask or engagement objective.

**Inputs:**

-   Historical giving

-   Capacity

-   Affinity

-   Relationship strength

-   Comparable gifts

-   Organization history

-   Program requirements

-   Timing

**Output example:**

Recommended initial ask: \$10,000--\$15,000

Confidence: 0.79

Rationale:

-   Previous gifts

-   Housing affinity

-   Regional connection

-   Relationship pathway

-   Comparable nonprofit gifts

**Default autonomy:** A2\
**Human boundary:** Final solicitation decision

**BEN-STR-03 --- Cultivation Strategy Agent**

**Mission:**\
Create a multi-step relationship-development plan when immediate
solicitation is not appropriate.

**Responsibilities:**

-   Determine information gaps

-   Identify relationship-building opportunities

-   Recommend sequence

-   Establish milestones

-   Define signals for advancement

-   Determine when cultivation should stop

**Default autonomy:** A2

**BEN-STR-04 --- Next-Best-Action Agent**

**Mission:**\
Continuously determine the most valuable next action for each qualified
opportunity.

Possible outputs:

-   Research deeper

-   Wait

-   Seek introduction

-   Update profile

-   Prepare foundation request

-   Request human review

-   Add to cultivation

-   Monitor for event

-   Disqualify

-   Reprioritize

This agent closes the loop between research and operational fundraising
strategy.

**Default autonomy:** A3

**FAMILY 7 --- KNOWLEDGE INTEGRITY**

**BEN-KNW-01 --- Prospect Digital Twin Agent**

**Mission:**\
Maintain the living structured representation of each prospect.

The digital twin should integrate:

-   Identity

-   Biography

-   Organizations

-   Companies

-   Foundations

-   Giving

-   Wealth indicators

-   Relationships

-   Evidence

-   Timeline

-   Affinity

-   Capacity

-   Opportunities

-   Research gaps

-   Contradictions

-   Current strategy

-   Monitoring events

**Responsibilities:**

-   Maintain canonical prospect state

-   Preserve historical facts

-   Track superseded information

-   Expose current research gaps

-   Coordinate state consumption by agents

**Default autonomy:** A3

**BEN-KNW-02 --- Entity Resolution Agent**

**Mission:**\
Reason through ambiguous identities and determine whether records refer
to the same entity.

**Example problems:**

-   Two executives with same name

-   Multiple business entities

-   Changed surname

-   Foundation and personal address overlap

-   Duplicate CRM records

**Outputs:**

MATCH\
PROBABLE_MATCH\
UNRESOLVED\
NOT_MATCH

with evidence and confidence.

**Default autonomy:** A3\
**Human boundary:** Sensitive/high-impact identity linkage

**BEN-KNW-03 --- Evidence & Provenance Verification Agent**

**Mission:**\
Verify that consequential claims are supported by permissible, traceable
evidence.

**Responsibilities:**

-   Validate source

-   Validate citation

-   Check evidence actually supports claim

-   Identify circular citations

-   Assign source tier

-   Determine freshness

-   Validate inference labeling

-   Require corroboration where appropriate

**Default autonomy:** A3

**BEN-KNW-04 --- Contradiction & Freshness Investigator**

**Mission:**\
Detect conflicting or outdated prospect information and determine what
should remain canonical.

**Example:**

Source A:\
Prospect is chairman.

Source B:\
Prospect left board in 2024.

Agent determines:

-   Temporal truth

-   Current status

-   Historical relationship

-   Appropriate graph update

**Responsibilities:**

-   Contradiction investigation

-   Time-aware reasoning

-   Supersession

-   Staleness detection

-   Re-research triggers

**Default autonomy:** A3

**COMPLETE AGENT COUNT**

The resulting initial registry contains:

**Supervisory & Orchestration --- 6**\
BEN-SUP-01 through BEN-SUP-06

**Discovery --- 8**\
BEN-DIS-01 through BEN-DIS-08

**Core Intelligence --- 10**\
BEN-INT-01 through BEN-INT-10

**Relationship Intelligence --- 6**\
BEN-REL-01 through BEN-REL-06

**Qualification --- 5**\
BEN-QLF-01 through BEN-QLF-05

**Strategy --- 4**\
BEN-STR-01 through BEN-STR-04

**Knowledge Integrity --- 4**\
BEN-KNW-01 through BEN-KNW-04

**TOTAL: 43 AGENTS**

To bring the recommended production fleet to 44, add the following
cross-cutting agent:

**BEN-OPS-01 --- Agent Fleet Performance & Learning Agent**

**Family:** Operations, Evaluation & Learning

**Mission:**\
Continuously evaluate whether the Prospect Intelligence agent fleet is
actually improving research outcomes and determine where behaviors,
routing, tools, or research strategies should be adjusted.

**Responsibilities:**

-   Measure agent success rates

-   Compare predicted vs actual outcomes

-   Measure research precision

-   Measure false-positive rates

-   Analyze human corrections

-   Analyze disqualifications

-   Track research cost per qualified prospect

-   Track evidence completeness

-   Identify underperforming agents

-   Identify redundant research behavior

-   Detect excessive tool usage

-   Detect ineffective research paths

-   Recommend prompt/model/tool changes

-   Recommend autonomy reductions

-   Identify opportunities for controlled autonomy increases

-   Feed validated learning into future research strategy

-   Preserve experiment history

-   Prevent uncontrolled self-modification

**Inputs:**

-   Agent run history

-   Research outcomes

-   Human corrections

-   Prospect qualification results

-   Donation/grant outcomes

-   Cost ledger

-   Evidence-quality scores

-   Evaluation suites

**Outputs:**

-   Agent-performance reports

-   Routing recommendations

-   Model-selection recommendations

-   Research-policy recommendations

-   Evaluation failures

-   Controlled learning proposals

**Default autonomy:** A1/A2

**Human boundary:**\
May recommend but may not independently:

-   Increase autonomy

-   Change security policy

-   Change privacy policy

-   Modify canonical facts

-   Remove safety controls

-   Rewrite production governance

**Cadence:** Continuous + scheduled evaluation

**FINAL FLEET COUNT**

**44 genuine agentic agents**

Supporting them should be approximately **20--30 deterministic
infrastructure services**, including:

-   Durable workflow engine

-   Policy enforcement engine

-   Source registry

-   Search/retrieval gateway

-   Web crawler

-   Browser automation broker

-   Form 990 parser

-   SEC/EDGAR connector

-   News/search connectors

-   Licensed database adapters

-   Entity-resolution support service

-   Graph database

-   Evidence ledger

-   Audit ledger

-   CRM synchronization service

-   Cost ledger

-   Model gateway

-   Rate-limit manager

-   Queue/event infrastructure

-   Notification system

-   Observability

-   Evaluation infrastructure

-   Tenant isolation

-   RBAC/ABAC

-   Feature flags

-   Kill switches

These services should support agents but must not be artificially
counted as agents.

**EXECUTION PRINCIPLE**

The 44-agent fleet is a registry, not a requirement to invoke all 44 for
every prospect.

A weak candidate might require:

**3--5 agents**

A normal qualified prospect might involve:

**8--15 agents**

A high-value major-donor prospect could warrant:

**15--25 specialized agents**

A strategically important or ambiguous prospect may trigger additional
critic, contradiction, relationship, capacity, and recovery work.

The Chief Prospect Intelligence Orchestrator and Research Portfolio
Allocator should determine research depth dynamically.

This produces the desired behavior:

**DISCOVER\
→ PRIORITIZE\
→ RESOLVE IDENTITY\
→ RESEARCH IN PARALLEL\
→ BUILD GRAPH\
→ VERIFY EVIDENCE\
→ IDENTIFY RELATIONSHIPS\
→ ASSESS AFFINITY\
→ ASSESS CAPACITY\
→ QUALIFY\
→ CRITIQUE\
→ DETERMINE TIMING\
→ DEVELOP STRATEGY\
→ SYNCHRONIZE\
→ MONITOR\
→ OBSERVE OUTCOMES\
→ LEARN\
→ REPLAN**

The objective is therefore not "44 AI workers."

The objective is a coordinated intelligence organization in software in
which each specialist owns a distinct reasoning responsibility, while
supervisory agents dynamically decide which specialists are worth
invoking and deterministic infrastructure guarantees durability,
security, provenance, compliance, and execution control.
