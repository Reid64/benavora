-- Migration 101: Autonomous Orchestrator Enterprise Hardening
--
-- Supports worker/autonomous-orchestrator.ts's 2026-07-20 enterprise
-- hardening pass (exact per-agent CST cron slots, per-org concurrency,
-- platform-level agent handling, nightly report). Two independent fixes:
--
-- 1. agent_type enum gaps. Three literal agent_type values this orchestrator
--    already writes (or now writes for the first time) were never added to
--    the strict Postgres enum (migration 001), per the recurring gap this
--    codebase has hit before (090/091/093/096/097/098's own "add it up
--    front" comments):
--      - 'autonomous_orchestrator' -- runOrgPipeline()'s per-org wrapper row
--        has used this literal since the orchestrator's very first version,
--        but it was never added to the enum. Every insert has been silently
--        throwing (caught by the try/catch around it, so the nightly run
--        itself never crashed, but no wrapper row has ever actually been
--        written). See project memory `benavora-agent-type-enum-gap`.
--      - 'ag-36-learning-network' -- learning-network-aggregator-agent.ts's
--        own header comment (see that file) already flags this exact gap:
--        "not yet a value in the agent_type Postgres enum... this hardening
--        pass" is what finally wires AG-36 into a real cron slot, so its
--        first scheduled run needs this value to exist.
--      - 'ag-17-discovery' -- OpportunityDiscoveryAgent's own agentId
--        (src/lib/agents/opportunity-discovery-agent.ts). Migration
--        085_fundraising_simulator.sql's own header comment already lists
--        this as one of the pre-existing unreachable Generation-2 agents
--        (alongside ag-36-learning-network, fixed above). This hardening
--        pass gives OpportunityDiscoveryAgent its first real dedicated cron
--        slot (1:00 AM), so its startRun() insert needs this value to exist
--        or every single nightly discovery run fails before any work
--        happens, silently, forever.
--
-- 2. org_autonomous_config toggles for the four newer AutonomousAgent
--    subclasses this hardening pass gives their own dedicated per-org nightly
--    slot (requirement 3: "check the specific toggle for this agent"). None
--    of fundability-scorer-agent.ts, donor-intent-monitor-agent.ts,
--    community-need-predictor-agent.ts, or strategic-advisor-agent.ts had a
--    dedicated toggle column before this - each file's own header comment
--    documents that its agent "runs whenever a future orchestrator
--    registration instantiates it per org, not gated on a toggle that
--    doesn't exist." This migration adds that toggle, and
--    worker/autonomous-orchestrator.ts's new per-agent schedule functions
--    read it. Default false, matching every other auto_*_enabled column and
--    BEHAVIORAL_CONTRACTS.md section 35's "created with all flags=false ...
--    opt-in default."

ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'autonomous_orchestrator';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-36-learning-network';
ALTER TYPE agent_type ADD VALUE IF NOT EXISTS 'ag-17-discovery';

ALTER TABLE org_autonomous_config
  ADD COLUMN IF NOT EXISTS auto_fundability_enabled boolean DEFAULT false;
ALTER TABLE org_autonomous_config
  ADD COLUMN IF NOT EXISTS auto_donor_intent_enabled boolean DEFAULT false;
ALTER TABLE org_autonomous_config
  ADD COLUMN IF NOT EXISTS auto_community_need_enabled boolean DEFAULT false;
ALTER TABLE org_autonomous_config
  ADD COLUMN IF NOT EXISTS auto_strategic_advisor_enabled boolean DEFAULT false;
