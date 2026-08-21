--
-- PostgreSQL database dump
--

\restrict DtNjR4CZPwGhgI3zk4EKCB1R4FKCwCRZLnhtRLrdNNIh6CPJLytUf8Ztlde9mbo

-- Dumped from database version 17.6
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: auth; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA auth;


--
-- Name: extensions; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA extensions;


--
-- Name: graphql; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql;


--
-- Name: graphql_public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA graphql_public;


--
-- Name: pgbouncer; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgbouncer;


--
-- Name: realtime; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA realtime;


--
-- Name: storage; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA storage;


--
-- Name: vault; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA vault;


--
-- Name: pg_stat_statements; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA extensions;


--
-- Name: EXTENSION pg_stat_statements; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_stat_statements IS 'track planning and execution statistics of all SQL statements executed';


--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;


--
-- Name: EXTENSION pgcrypto; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION pgcrypto IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS supabase_vault WITH SCHEMA vault;


--
-- Name: EXTENSION supabase_vault; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION supabase_vault IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: vector; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;


--
-- Name: EXTENSION vector; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION vector IS 'vector data type and ivfflat and hnsw access methods';


--
-- Name: aal_level; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.aal_level AS ENUM (
    'aal1',
    'aal2',
    'aal3'
);


--
-- Name: code_challenge_method; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.code_challenge_method AS ENUM (
    's256',
    'plain'
);


--
-- Name: factor_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_status AS ENUM (
    'unverified',
    'verified'
);


--
-- Name: factor_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.factor_type AS ENUM (
    'totp',
    'webauthn',
    'phone'
);


--
-- Name: oauth_authorization_status; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_authorization_status AS ENUM (
    'pending',
    'approved',
    'denied',
    'expired'
);


--
-- Name: oauth_client_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_client_type AS ENUM (
    'public',
    'confidential'
);


--
-- Name: oauth_registration_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_registration_type AS ENUM (
    'dynamic',
    'manual'
);


--
-- Name: oauth_response_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.oauth_response_type AS ENUM (
    'code'
);


--
-- Name: one_time_token_type; Type: TYPE; Schema: auth; Owner: -
--

CREATE TYPE auth.one_time_token_type AS ENUM (
    'confirmation_token',
    'reauthentication_token',
    'recovery_token',
    'email_change_token_new',
    'email_change_token_current',
    'phone_change_token'
);


--
-- Name: agent_run_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.agent_run_status AS ENUM (
    'pending',
    'running',
    'completed',
    'failed'
);


--
-- Name: agent_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.agent_type AS ENUM (
    'corporate_research',
    'foundation_research',
    'government_research',
    'local_sponsorship',
    'eligibility_scoring',
    'deadline_extraction',
    'grant_summary',
    'fit_analysis',
    'narrative_drafting',
    'budget_builder',
    'compliance_check',
    'review',
    'final_assembly',
    'recursive_learning',
    'cold_outreach',
    'funder_intel',
    'email_parser',
    'funder_relationship',
    'competitor_intel',
    'grants_gov_research',
    'sam_gov_research',
    'propublica_mining',
    'state_portal',
    'custom_api_research',
    'giving_history',
    'success_probability',
    'deadline_prediction',
    'application_cloning',
    'follow_up_generator',
    'consensus_validation',
    'ag-17-discovery',
    'ag-19-relationship',
    'ag-25-deadline-prediction',
    'ag-30-donor-intent',
    'ag-38-self-improvement',
    'ag-digest',
    'autonomous_orchestrator',
    'ag-15-probability',
    'ag-28-followup',
    'ag-02',
    'ag-03-deadline-extraction',
    'ag-04-fit-analysis',
    'ag-05-draft',
    'ag-06-budget-builder',
    'ag-07-compliance-check',
    'ag-18-reputation',
    'ag-32-relationship-graph',
    'ag-10-grant-dna',
    'ag-26-forecast',
    'ag-27-board-packet',
    'ag-41-impact-simulation',
    'ag-42-change-monitor',
    'ag-29-knowledge-indexer',
    'ea01_giving_detector',
    'ea02_community_outreach_detector',
    'ea03_sponsorship_detector',
    'ea04_foundation_detector',
    'ea05_career_page_analyzer',
    'ea06_press_release_analyzer',
    'ea07_esg_analyzer',
    'ea08_executive_biography_analyzer',
    'ea09_contact_extractor',
    'ea10_social_media_analyzer',
    'ag22_propensity_scoring',
    'ag-36-learning-network',
    'ag-43-funder-signals'
);


--
-- Name: alert_severity; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.alert_severity AS ENUM (
    'info',
    'warning',
    'critical'
);


--
-- Name: alert_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.alert_type AS ENUM (
    'deadline_due',
    'new_opportunity',
    'application_action',
    'draft_review',
    'system'
);


--
-- Name: audit_action; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.audit_action AS ENUM (
    'create',
    'update',
    'delete',
    'login',
    'logout',
    'export',
    'invite',
    'role_change',
    'billing_change',
    'agent_run',
    'submission'
);


--
-- Name: automation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.automation_status AS ENUM (
    'pending',
    'in_progress',
    'awaiting_approval',
    'approved',
    'submitted',
    'failed',
    'cancelled'
);


--
-- Name: calendar_sync_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.calendar_sync_status AS ENUM (
    'active',
    'paused',
    'error',
    'disconnected'
);


--
-- Name: campaign_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.campaign_status AS ENUM (
    'draft',
    'active',
    'paused',
    'completed'
);


--
-- Name: campaign_step_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.campaign_step_status AS ENUM (
    'pending',
    'sent',
    'opened',
    'replied',
    'bounced'
);


--
-- Name: contact_relationship; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.contact_relationship AS ENUM (
    'cold',
    'warm',
    'active',
    'champion'
);


--
-- Name: deadline_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.deadline_type AS ENUM (
    'application_deadline',
    'follow_up_date',
    'reporting_deadline',
    'renewal_date',
    'document_expiration'
);


--
-- Name: document_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.document_category AS ENUM (
    'tax_documents',
    'legal_documents',
    'financial_documents',
    'program_documents',
    'marketing_materials',
    'letters_of_support',
    'application_attachments',
    'photos'
);


--
-- Name: donor_discovery_connector_provider; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.donor_discovery_connector_provider AS ENUM (
    'apollo',
    'hunter',
    'zoominfo',
    'clay',
    'google_places'
);


--
-- Name: donor_discovery_connector_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.donor_discovery_connector_status AS ENUM (
    'pending',
    'active',
    'invalid',
    'revoked'
);


--
-- Name: donor_discovery_pipeline_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.donor_discovery_pipeline_stage AS ENUM (
    'new',
    'reviewing',
    'contacted',
    'applied',
    'received',
    'rejected',
    'archived'
);


--
-- Name: donor_discovery_request_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.donor_discovery_request_status AS ENUM (
    'queued',
    'enumerating',
    'enriching',
    'scoring',
    'complete',
    'failed'
);


--
-- Name: donor_discovery_taxonomy_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.donor_discovery_taxonomy_kind AS ENUM (
    'naics',
    'civic',
    'association',
    'ntee'
);


--
-- Name: draft_queue_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.draft_queue_status AS ENUM (
    'pending',
    'generating',
    'generated',
    'review',
    'approved',
    'rejected',
    'submitted',
    'failed'
);


--
-- Name: draft_template_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.draft_template_type AS ENUM (
    'grant_narrative',
    'donation_request_letter',
    'budget_narrative',
    'impact_statement',
    'letter_of_inquiry',
    'full_proposal'
);


--
-- Name: draft_trigger; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.draft_trigger AS ENUM (
    'auto_scheduled',
    'eligibility_threshold',
    'deadline_approaching',
    'manual'
);


--
-- Name: email_direction; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_direction AS ENUM (
    'inbound',
    'outbound'
);


--
-- Name: email_sync_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.email_sync_status AS ENUM (
    'active',
    'paused',
    'error',
    'disconnected'
);


--
-- Name: enrichment_job_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enrichment_job_status AS ENUM (
    'queued',
    'running',
    'paused',
    'completed',
    'failed',
    'cancelled'
);


--
-- Name: enrichment_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.enrichment_source AS ENUM (
    'irs_990',
    'propublica',
    'web_search',
    'website_scrape',
    'manual'
);


--
-- Name: funder_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.funder_category AS ENUM (
    'corporate_donation',
    'corporate_sponsorship',
    'corporate_foundation',
    'private_foundation',
    'government_grant',
    'local_community_grant',
    'housing_grant',
    'education_grant',
    'faith_compatible_grant',
    'in_kind_donation',
    'materials_donation',
    'down_payment_assistance'
);


--
-- Name: humanization_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.humanization_status AS ENUM (
    'not_humanized',
    'pending',
    'humanized',
    'failed'
);


--
-- Name: invitation_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.invitation_status AS ENUM (
    'pending',
    'accepted',
    'expired',
    'cancelled'
);


--
-- Name: knowledge_base_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.knowledge_base_category AS ENUM (
    'mission',
    'vision',
    'need_statement',
    'program_description',
    'impact',
    'capacity',
    'sustainability',
    'partnerships',
    'budget_justification',
    'organizational_history',
    'custom'
);


--
-- Name: marketplace_listing_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.marketplace_listing_status AS ENUM (
    'active',
    'matched',
    'fulfilled',
    'expired',
    'cancelled'
);


--
-- Name: marketplace_match_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.marketplace_match_status AS ENUM (
    'suggested',
    'requested',
    'approved',
    'declined',
    'withdrawn'
);


--
-- Name: opportunity_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.opportunity_status AS ENUM (
    'open',
    'applied',
    'closed',
    'expired'
);


--
-- Name: outcome_result; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.outcome_result AS ENUM (
    'awarded',
    'denied',
    'partial'
);


--
-- Name: pipeline_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.pipeline_stage AS ENUM (
    'discovered',
    'eligibility_review',
    'qualified',
    'drafting',
    'awaiting_documents',
    'ready_for_review',
    'submitted',
    'follow_up_due',
    'awarded',
    'denied',
    'reporting_required',
    'renewal_opportunity'
);


--
-- Name: platform_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.platform_role AS ENUM (
    'platform_owner',
    'staff_admin',
    'staff_support',
    'staff_readonly'
);


--
-- Name: session_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.session_type AS ENUM (
    'form_fill',
    'document_upload',
    'portal_login'
);


--
-- Name: staff_permission; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.staff_permission AS ENUM (
    'tenant_view',
    'tenant_manage',
    'tenant_impersonate',
    'billing_view',
    'billing_manage',
    'feature_flags_view',
    'feature_flags_manage',
    'staff_view',
    'staff_manage',
    'queue_view',
    'queue_manage',
    'queue_emergency_stop',
    'analytics_view',
    'error_view',
    'error_resolve',
    'sales_outreach_view',
    'sales_outreach_manage',
    'system_health_view',
    'audit_log_view'
);


--
-- Name: subscription_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.subscription_tier AS ENUM (
    'free',
    'starter',
    'professional',
    'enterprise'
);


--
-- Name: task_priority; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_priority AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


--
-- Name: task_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.task_status AS ENUM (
    'open',
    'in_progress',
    'blocked',
    'completed',
    'cancelled'
);


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.user_role AS ENUM (
    'owner',
    'admin',
    'writer',
    'viewer'
);


--
-- Name: validation_verdict; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.validation_verdict AS ENUM (
    'verified',
    'discrepancy',
    'unverifiable'
);


--
-- Name: action; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.action AS ENUM (
    'INSERT',
    'UPDATE',
    'DELETE',
    'TRUNCATE',
    'ERROR'
);


--
-- Name: equality_op; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.equality_op AS ENUM (
    'eq',
    'neq',
    'lt',
    'lte',
    'gt',
    'gte',
    'in',
    'like',
    'ilike',
    'is',
    'match',
    'imatch',
    'isdistinct'
);


--
-- Name: user_defined_filter; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.user_defined_filter AS (
	column_name text,
	op realtime.equality_op,
	value text,
	negate boolean
);


--
-- Name: wal_column; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_column AS (
	name text,
	type_name text,
	type_oid oid,
	value jsonb,
	is_pkey boolean,
	is_selectable boolean
);


--
-- Name: wal_rls; Type: TYPE; Schema: realtime; Owner: -
--

CREATE TYPE realtime.wal_rls AS (
	wal jsonb,
	is_rls_enabled boolean,
	subscription_ids uuid[],
	errors text[]
);


--
-- Name: buckettype; Type: TYPE; Schema: storage; Owner: -
--

CREATE TYPE storage.buckettype AS ENUM (
    'STANDARD',
    'ANALYTICS',
    'VECTOR'
);


--
-- Name: email(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.email() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$$;


--
-- Name: FUNCTION email(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.email() IS 'Deprecated. Use auth.jwt() -> ''email'' instead.';


--
-- Name: jwt(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.jwt() RETURNS jsonb
    LANGUAGE sql STABLE
    AS $$
  select 
    coalesce(
        nullif(current_setting('request.jwt.claim', true), ''),
        nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
$$;


--
-- Name: role(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.role() RETURNS text
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$$;


--
-- Name: FUNCTION role(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.role() IS 'Deprecated. Use auth.jwt() -> ''role'' instead.';


--
-- Name: uid(); Type: FUNCTION; Schema: auth; Owner: -
--

CREATE FUNCTION auth.uid() RETURNS uuid
    LANGUAGE sql STABLE
    AS $$
  select 
  coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;


--
-- Name: FUNCTION uid(); Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON FUNCTION auth.uid() IS 'Deprecated. Use auth.jwt() -> ''sub'' instead.';


--
-- Name: grant_pg_cron_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_cron_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_cron'
  )
  THEN
    grant usage on schema cron to postgres with grant option;

    alter default privileges in schema cron grant all on tables to postgres with grant option;
    alter default privileges in schema cron grant all on functions to postgres with grant option;
    alter default privileges in schema cron grant all on sequences to postgres with grant option;

    alter default privileges for user supabase_admin in schema cron grant all
        on sequences to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on tables to postgres with grant option;
    alter default privileges for user supabase_admin in schema cron grant all
        on functions to postgres with grant option;

    grant all privileges on all tables in schema cron to postgres with grant option;
    revoke all on table cron.job from postgres;
    grant select on table cron.job to postgres with grant option;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_cron_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_cron_access() IS 'Grants access to pg_cron';


--
-- Name: grant_pg_graphql_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_graphql_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
begin
    if not exists (
        select 1
        from pg_event_trigger_ddl_commands() ev
        join pg_catalog.pg_extension e on ev.objid = e.oid
        where e.extname = 'pg_graphql'
    ) then
        return;
    end if;

    drop function if exists graphql_public.graphql;
    create or replace function graphql_public.graphql(
        "operationName" text default null,
        query text default null,
        variables jsonb default null,
        extensions jsonb default null
    )
        returns jsonb
        language sql
    as $$
        select graphql.resolve(
            query := query,
            variables := coalesce(variables, '{}'),
            "operationName" := "operationName",
            extensions := extensions
        );
    $$;

    -- Attach the wrapper to the extension so DROP EXTENSION cascades to it,
    -- which in turn triggers set_graphql_placeholder to reinstall the "not enabled" stub.
    alter extension pg_graphql add function graphql_public.graphql(text, text, jsonb, jsonb);

    grant usage on schema graphql to postgres, anon, authenticated, service_role;
    grant execute on function graphql.resolve to postgres, anon, authenticated, service_role;
    grant usage on schema graphql to postgres with grant option;
    grant usage on schema graphql_public to postgres with grant option;
end;
$_$;


--
-- Name: FUNCTION grant_pg_graphql_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_graphql_access() IS 'Grants access to pg_graphql';


--
-- Name: grant_pg_net_access(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.grant_pg_net_access() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_event_trigger_ddl_commands() AS ev
    JOIN pg_extension AS ext
    ON ev.objid = ext.oid
    WHERE ext.extname = 'pg_net'
  )
  THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_roles
      WHERE rolname = 'supabase_functions_admin'
    )
    THEN
      CREATE USER supabase_functions_admin NOINHERIT CREATEROLE LOGIN NOREPLICATION;
    END IF;

    GRANT USAGE ON SCHEMA net TO supabase_functions_admin, postgres, anon, authenticated, service_role;

    IF EXISTS (
      SELECT FROM pg_extension
      WHERE extname = 'pg_net'
      -- all versions in use on existing projects as of 2025-02-20
      -- version 0.12.0 onwards don't need these applied
      AND extversion IN ('0.2', '0.6', '0.7', '0.7.1', '0.8', '0.10.0', '0.11.0')
    ) THEN
      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SECURITY DEFINER;

      ALTER function net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;
      ALTER function net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) SET search_path = net;

      REVOKE ALL ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;
      REVOKE ALL ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) FROM PUBLIC;

      GRANT EXECUTE ON FUNCTION net.http_get(url text, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
      GRANT EXECUTE ON FUNCTION net.http_post(url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer) TO supabase_functions_admin, postgres, anon, authenticated, service_role;
    END IF;
  END IF;
END;
$$;


--
-- Name: FUNCTION grant_pg_net_access(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.grant_pg_net_access() IS 'Grants access to pg_net';


--
-- Name: pgrst_ddl_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_ddl_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN SELECT * FROM pg_event_trigger_ddl_commands()
  LOOP
    IF cmd.command_tag IN (
      'CREATE SCHEMA', 'ALTER SCHEMA'
    , 'CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO', 'ALTER TABLE'
    , 'CREATE FOREIGN TABLE', 'ALTER FOREIGN TABLE'
    , 'CREATE VIEW', 'ALTER VIEW'
    , 'CREATE MATERIALIZED VIEW', 'ALTER MATERIALIZED VIEW'
    , 'CREATE FUNCTION', 'ALTER FUNCTION'
    , 'CREATE TRIGGER'
    , 'CREATE TYPE', 'ALTER TYPE'
    , 'CREATE RULE'
    , 'COMMENT'
    )
    -- don't notify in case of CREATE TEMP table or other objects created on pg_temp
    AND cmd.schema_name is distinct from 'pg_temp'
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: pgrst_drop_watch(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.pgrst_drop_watch() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_dropped_objects()
  LOOP
    IF obj.object_type IN (
      'schema'
    , 'table'
    , 'foreign table'
    , 'view'
    , 'materialized view'
    , 'function'
    , 'trigger'
    , 'type'
    , 'rule'
    )
    AND obj.is_temporary IS false -- no pg_temp objects
    THEN
      NOTIFY pgrst, 'reload schema';
    END IF;
  END LOOP;
END; $$;


--
-- Name: set_graphql_placeholder(); Type: FUNCTION; Schema: extensions; Owner: -
--

CREATE FUNCTION extensions.set_graphql_placeholder() RETURNS event_trigger
    LANGUAGE plpgsql
    AS $_$
    DECLARE
    graphql_is_dropped bool;
    BEGIN
    graphql_is_dropped = (
        SELECT ev.schema_name = 'graphql_public'
        FROM pg_event_trigger_dropped_objects() AS ev
        WHERE ev.schema_name = 'graphql_public'
    );

    IF graphql_is_dropped
    THEN
        create or replace function graphql_public.graphql(
            "operationName" text default null,
            query text default null,
            variables jsonb default null,
            extensions jsonb default null
        )
            returns jsonb
            language plpgsql
        as $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;
    END IF;

    END;
$_$;


--
-- Name: FUNCTION set_graphql_placeholder(); Type: COMMENT; Schema: extensions; Owner: -
--

COMMENT ON FUNCTION extensions.set_graphql_placeholder() IS 'Reintroduces placeholder function for graphql_public.graphql';


--
-- Name: graphql(text, text, jsonb, jsonb); Type: FUNCTION; Schema: graphql_public; Owner: -
--

CREATE FUNCTION graphql_public.graphql("operationName" text DEFAULT NULL::text, query text DEFAULT NULL::text, variables jsonb DEFAULT NULL::jsonb, extensions jsonb DEFAULT NULL::jsonb) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
            DECLARE
                server_version float;
            BEGIN
                server_version = (SELECT (SPLIT_PART((select version()), ' ', 2))::float);

                IF server_version >= 14 THEN
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql extension is not enabled.'
                            )
                        )
                    );
                ELSE
                    RETURN jsonb_build_object(
                        'errors', jsonb_build_array(
                            jsonb_build_object(
                                'message', 'pg_graphql is only available on projects running Postgres 14 onwards.'
                            )
                        )
                    );
                END IF;
            END;
        $$;


--
-- Name: get_auth(text); Type: FUNCTION; Schema: pgbouncer; Owner: -
--

CREATE FUNCTION pgbouncer.get_auth(p_usename text) RETURNS TABLE(username text, password text)
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  BEGIN
      RAISE DEBUG 'PgBouncer auth request: %', p_usename;

      RETURN QUERY
      SELECT
          rolname::text,
          CASE WHEN rolvaliduntil < now()
              THEN null
              ELSE rolpassword::text
          END
      FROM pg_authid
      WHERE rolname=$1 and rolcanlogin;
  END;
  $_$;


--
-- Name: auto_create_renewal(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.auto_create_renewal() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
declare
  v_opp_id      uuid;
  v_funder_id   uuid;
  v_recurrence  text;
begin
  if new.result <> 'awarded' then
    return new;
  end if;

  select a.opportunity_id
  into   v_opp_id
  from   applications a
  where  a.id = new.application_id
  limit  1;

  if v_opp_id is null then
    return new;
  end if;

  select o.recurrence, o.funder_id
  into   v_recurrence, v_funder_id
  from   opportunities o
  where  o.id = v_opp_id
  limit  1;

  -- Only create for recurring opportunities
  if v_recurrence is null or trim(v_recurrence) = '' then
    return new;
  end if;

  -- Skip if renewal already exists for this application
  if exists (select 1 from renewals r where r.application_id = new.application_id) then
    return new;
  end if;

  insert into renewals (
    organization_id,
    application_id,
    opportunity_id,
    funder_id,
    renewal_type,
    reporting_deadline,
    renewal_window_start,
    renewal_window_end,
    compliance_status
  ) values (
    new.organization_id,
    new.application_id,
    v_opp_id,
    v_funder_id,
    v_recurrence,
    (current_date + interval '1 year')::date,
    (current_date + interval '9 months')::date,
    (current_date + interval '11 months')::date,
    'pending'
  );

  return new;
end;
$$;


--
-- Name: block_if_onboarding_edit_restricted(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_if_onboarding_edit_restricted() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF public.is_onboarding_edit_restricted() THEN
    RAISE EXCEPTION 'This demo account cannot modify organizational profile data.'
      USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;


--
-- Name: block_restricted_organizations_update(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.block_restricted_organizations_update() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  IF public.is_onboarding_edit_restricted() THEN
    IF NEW.name IS DISTINCT FROM OLD.name
      OR NEW.ein IS DISTINCT FROM OLD.ein
      OR NEW.tax_status IS DISTINCT FROM OLD.tax_status
      OR NEW.mission_statement IS DISTINCT FROM OLD.mission_statement
      OR NEW.vision_statement IS DISTINCT FROM OLD.vision_statement
      OR NEW.founding_date IS DISTINCT FROM OLD.founding_date
      OR NEW.founder_name IS DISTINCT FROM OLD.founder_name
      OR NEW.founder_bio IS DISTINCT FROM OLD.founder_bio
      OR NEW.service_area IS DISTINCT FROM OLD.service_area
      OR NEW.target_population IS DISTINCT FROM OLD.target_population
      OR NEW.annual_budget IS DISTINCT FROM OLD.annual_budget
      OR NEW.total_staff IS DISTINCT FROM OLD.total_staff
      OR NEW.total_volunteers IS DISTINCT FROM OLD.total_volunteers
      OR NEW.extended_profile IS DISTINCT FROM OLD.extended_profile
      OR NEW.onboarding_step IS DISTINCT FROM OLD.onboarding_step
      OR NEW.onboarding_progress IS DISTINCT FROM OLD.onboarding_progress
      OR NEW.onboarding_completed IS DISTINCT FROM OLD.onboarding_completed
      OR NEW.onboarding_completed_at IS DISTINCT FROM OLD.onboarding_completed_at
    THEN
      RAISE EXCEPTION 'This demo account cannot modify this organization field.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: current_org_id(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.current_org_id() RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT organization_id FROM public.profiles WHERE id = auth.uid();
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: donor_discovery_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donor_discovery_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    taxonomy_ids uuid[] DEFAULT '{}'::uuid[] NOT NULL,
    geography jsonb DEFAULT '{}'::jsonb NOT NULL,
    status public.donor_discovery_request_status DEFAULT 'queued'::public.donor_discovery_request_status NOT NULL,
    counts jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    completed_at timestamp with time zone
);


--
-- Name: donor_discovery_claim_request(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donor_discovery_claim_request() RETURNS public.donor_discovery_requests
    LANGUAGE plpgsql
    AS $$
declare
  v_row public.donor_discovery_requests;
begin
  select * into v_row
  from public.donor_discovery_requests
  where status = 'queued'
  order by created_at asc
  limit 1
  for update skip locked;

  if v_row.id is null then
    return null;
  end if;

  update public.donor_discovery_requests
  set status = 'enumerating'
  where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;


--
-- Name: donor_discovery_extract_domain(text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donor_discovery_extract_domain(url text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
  select lower(regexp_replace(url, '^(?:https?://)?(?:www\.)?([^/:?#]+).*$', '\1'))
  where url is not null and btrim(url) <> '';
$_$;


--
-- Name: donor_discovery_geo_distance_km(point, point); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donor_discovery_geo_distance_km(a point, b point) RETURNS double precision
    LANGUAGE sql IMMUTABLE
    AS $$
  select 2 * 6371 * asin(sqrt(
    power(sin(radians((b[1] - a[1]) / 2)), 2) +
    cos(radians(a[1])) * cos(radians(b[1])) *
    power(sin(radians((b[0] - a[0]) / 2)), 2)
  ));
$$;


--
-- Name: dd_api_spend; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dd_api_spend (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider text NOT NULL,
    month text NOT NULL,
    requests integer DEFAULT 0 NOT NULL,
    est_cost_usd numeric(10,4) DEFAULT 0 NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: donor_discovery_increment_api_spend(text, text, integer, numeric); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donor_discovery_increment_api_spend(p_provider text, p_month text, p_requests integer, p_cost_usd numeric) RETURNS public.dd_api_spend
    LANGUAGE plpgsql
    AS $$
declare
  v_row public.dd_api_spend;
begin
  insert into public.dd_api_spend (provider, month, requests, est_cost_usd)
  values (p_provider, p_month, p_requests, p_cost_usd)
  on conflict (provider, month)
  do update set
    requests = public.dd_api_spend.requests + excluded.requests,
    est_cost_usd = public.dd_api_spend.est_cost_usd + excluded.est_cost_usd,
    updated_at = now()
  returning * into v_row;

  return v_row;
end;
$$;


--
-- Name: donor_discovery_match_foundations(text[], double precision, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donor_discovery_match_foundations(p_candidate_names text[], p_min_similarity double precision DEFAULT 0.55, p_limit integer DEFAULT 5) RETURNS TABLE(foundation_id uuid, foundation_name text, website text, similarity double precision)
    LANGUAGE sql STABLE
    AS $$
  SELECT fd.id, fd.name, fd.website, best.sim
  FROM public.foundation_directory fd
  CROSS JOIN LATERAL (
    SELECT max(similarity(lower(fd.name), lower(cand))) AS sim
    FROM unnest(p_candidate_names) AS cand
  ) best
  WHERE best.sim > p_min_similarity
  ORDER BY best.sim DESC
  LIMIT p_limit;
$$;


--
-- Name: donor_discovery_directory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donor_discovery_directory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legal_name text NOT NULL,
    dba_name text,
    naics_codes text[] DEFAULT '{}'::text[] NOT NULL,
    civic_kind text,
    website text,
    hq_address text,
    geo point,
    phone text,
    enrichment jsonb DEFAULT '{}'::jsonb NOT NULL,
    enriched_at timestamp with time zone,
    source_adapters text[] DEFAULT '{}'::text[] NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    linked_foundation_id uuid,
    linkage_confidence numeric(4,3),
    CONSTRAINT donor_discovery_directory_linkage_confidence_range CHECK (((linkage_confidence IS NULL) OR ((linkage_confidence >= (0)::numeric) AND (linkage_confidence <= (1)::numeric))))
);


--
-- Name: donor_discovery_upsert_directory(text, text, text, double precision, double precision, text, text[], text); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donor_discovery_upsert_directory(p_legal_name text, p_website text, p_hq_address text, p_lat double precision, p_lng double precision, p_phone text, p_naics_codes text[], p_source_adapter text) RETURNS public.donor_discovery_directory
    LANGUAGE plpgsql
    AS $$
declare
  v_row public.donor_discovery_directory;
begin
  insert into public.donor_discovery_directory as d
    (legal_name, website, hq_address, geo, phone, naics_codes, source_adapters)
  values
    (
      p_legal_name,
      p_website,
      p_hq_address,
      case when p_lat is not null and p_lng is not null then point(p_lng, p_lat) else null end,
      p_phone,
      coalesce(p_naics_codes, '{}'),
      case when p_source_adapter is not null then array[p_source_adapter] else '{}' end
    )
  on conflict (lower(legal_name), public.donor_discovery_extract_domain(website))
  do update set
    website = coalesce(d.website, excluded.website),
    hq_address = coalesce(excluded.hq_address, d.hq_address),
    geo = coalesce(excluded.geo, d.geo),
    phone = coalesce(excluded.phone, d.phone),
    naics_codes = (select array(select distinct unnest(d.naics_codes || excluded.naics_codes))),
    source_adapters = (select array(select distinct unnest(d.source_adapters || excluded.source_adapters)))
  returning * into v_row;

  return v_row;
end;
$$;


--
-- Name: donor_discovery_upsert_directory_record(text, text, text, double precision, double precision, text, text[], text, text, jsonb); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.donor_discovery_upsert_directory_record(p_legal_name text, p_website text, p_hq_address text, p_lat double precision, p_lng double precision, p_phone text, p_naics_codes text[], p_civic_kind text, p_source_adapter text, p_enrichment jsonb) RETURNS public.donor_discovery_directory
    LANGUAGE plpgsql
    AS $$
declare
  v_domain text;
  v_match_id uuid;
  v_row public.donor_discovery_directory;
begin
  v_domain := public.donor_discovery_extract_domain(p_website);

  if v_domain is not null then
    select id into v_match_id
    from public.donor_discovery_directory
    where public.donor_discovery_extract_domain(website) = v_domain
    limit 1;
  end if;

  if v_match_id is null and p_lat is not null and p_lng is not null then
    select d.id into v_match_id
    from public.donor_discovery_directory d
    where d.geo is not null
      and similarity(lower(d.legal_name), lower(p_legal_name)) > 0.65
      and public.donor_discovery_geo_distance_km(d.geo, point(p_lng, p_lat)) <= 25
    order by similarity(lower(d.legal_name), lower(p_legal_name)) desc
    limit 1;
  end if;

  if v_match_id is not null then
    update public.donor_discovery_directory d
    set
      website = coalesce(d.website, p_website),
      hq_address = coalesce(d.hq_address, p_hq_address),
      geo = coalesce(d.geo, case when p_lat is not null and p_lng is not null then point(p_lng, p_lat) else null end),
      phone = coalesce(d.phone, p_phone),
      civic_kind = coalesce(d.civic_kind, p_civic_kind),
      naics_codes = (select array(select distinct unnest(d.naics_codes || coalesce(p_naics_codes, '{}')))),
      source_adapters = (select array(select distinct unnest(d.source_adapters || array[p_source_adapter]))),
      enrichment = coalesce(p_enrichment, '{}'::jsonb) || jsonb_strip_nulls(d.enrichment),
      enriched_at = case when p_enrichment is not null then now() else d.enriched_at end
    where d.id = v_match_id
    returning * into v_row;

    return v_row;
  end if;

  insert into public.donor_discovery_directory as d
    (legal_name, website, hq_address, geo, phone, civic_kind, naics_codes, source_adapters, enrichment, enriched_at)
  values (
    p_legal_name,
    p_website,
    p_hq_address,
    case when p_lat is not null and p_lng is not null then point(p_lng, p_lat) else null end,
    p_phone,
    p_civic_kind,
    coalesce(p_naics_codes, '{}'),
    array[p_source_adapter],
    coalesce(p_enrichment, '{}'::jsonb),
    case when p_enrichment is not null then now() else null end
  )
  returning * into v_row;

  return v_row;
end;
$$;


--
-- Name: increment_usage_tracking(uuid, text, date, date, integer); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.increment_usage_tracking(p_org_id uuid, p_resource_type text, p_period_start date, p_period_end date, p_amount integer DEFAULT 1) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO usage_tracking
    (organization_id, resource_type, period_start, period_end, count)
  VALUES
    (p_org_id, p_resource_type, p_period_start, p_period_end, p_amount)
  ON CONFLICT (organization_id, resource_type, period_start)
  DO UPDATE SET
    count      = usage_tracking.count + p_amount,
    updated_at = now();
END;
$$;


--
-- Name: is_onboarding_edit_restricted(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.is_onboarding_edit_restricted() RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT COALESCE(
    (SELECT restricted_onboarding_edit FROM public.profiles WHERE id = auth.uid()),
    false
  );
$$;


--
-- Name: marketplace_listing_owned_by_org(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.marketplace_listing_owned_by_org(p_listing_id uuid, p_org_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM marketplace_listings ml
    WHERE ml.id = p_listing_id
      AND ml.organization_id = p_org_id
  );
$$;


--
-- Name: marketplace_org_has_match_on_listing(uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.marketplace_org_has_match_on_listing(p_listing_id uuid, p_org_id uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
  SELECT EXISTS (
    SELECT 1 FROM marketplace_matches mm
    WHERE mm.listing_id = p_listing_id
      AND mm.organization_id = p_org_id
  );
$$;


--
-- Name: reassign_paused_submission_queue_item(uuid, uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.reassign_paused_submission_queue_item(p_id uuid, p_org_id uuid, p_assignee_id uuid, p_reviewer_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE submission_queue
  SET paused_history = COALESCE(paused_history, '[]'::jsonb) || jsonb_build_object(
        'action', 'reassigned',
        'reassigned_to', p_assignee_id,
        'reassigned_by', p_reviewer_id,
        'reassigned_at', now()
      )
  WHERE id = p_id
    AND organization_id = p_org_id
    AND status = 'paused_verification'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: register_organization(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.register_organization() RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
DECLARE
  uid        uuid := auth.uid();
  existing   uuid;
  new_org_id uuid;
  u_email    text;
  u_meta     jsonb;
  org_name   text;
  full_name  text;
BEGIN
  IF uid IS NULL THEN
    RAISE EXCEPTION 'register_organization: not authenticated';
  END IF;

  -- Idempotent: one organization per registering user.
  SELECT organization_id INTO existing FROM public.profiles WHERE id = uid;
  IF existing IS NOT NULL THEN
    RETURN existing;
  END IF;

  SELECT email, raw_user_meta_data
    INTO u_email, u_meta
    FROM auth.users
   WHERE id = uid;

  org_name  := NULLIF(btrim(COALESCE(u_meta->>'organization_name', '')), '');
  full_name := NULLIF(btrim(COALESCE(u_meta->>'full_name', '')), '');

  IF org_name IS NULL THEN
    org_name := 'My Organization';
  END IF;

  INSERT INTO public.organizations (name, email)
  VALUES (org_name, u_email)
  RETURNING id INTO new_org_id;

  INSERT INTO public.profiles (id, organization_id, email, full_name, role)
  VALUES (uid, new_org_id, u_email, full_name, 'owner');

  RETURN new_org_id;
END;
$$;


--
-- Name: renewals_set_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.renewals_set_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


--
-- Name: resume_paused_submission_queue_item(uuid, uuid, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.resume_paused_submission_queue_item(p_id uuid, p_org_id uuid, p_reviewer_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE submission_queue
  SET status = 'pending',
      paused_history = COALESCE(paused_history, '[]'::jsonb) || jsonb_build_object(
        'action', 'resumed',
        'reason', pause_reason,
        'paused_at', paused_at,
        'resumed_by', p_reviewer_id,
        'resumed_at', now()
      ),
      pause_reason = NULL,
      paused_at = NULL,
      paused_screenshot_path = NULL,
      resume_count = COALESCE(resume_count, 0) + 1
  WHERE id = p_id
    AND organization_id = p_org_id
    AND status = 'paused_verification'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: seed_default_platform_config(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.seed_default_platform_config() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO 'public'
    AS $$
BEGIN
  INSERT INTO platform_config (organization_id, key, value) VALUES
    (NEW.id, 'feature.research_agents',          'false'),
    (NEW.id, 'feature.browser_automation',       'false'),
    (NEW.id, 'feature.email_integration',        'false'),
    (NEW.id, 'feature.cold_outreach_email',      'false'),
    (NEW.id, 'feature.stripe_billing',           'false'),
    (NEW.id, 'ai.model',                         'claude-sonnet-4-6-20250514'),
    (NEW.id, 'ai.max_tokens',                    '4096'),
    (NEW.id, 'ai.confidence_threshold',          '70'),
    (NEW.id, 'learning.min_outcomes_for_scoring','5'),
    (NEW.id, 'learning.proven_narrative_threshold','2');
  RETURN NEW;
END;
$$;


--
-- Name: set_draft_version_number(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.set_draft_version_number() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  IF NEW.version_number IS NULL OR NEW.version_number = 0 THEN
    SELECT COALESCE(MAX(version_number), 0) + 1
      INTO NEW.version_number
      FROM public.draft_versions
     WHERE opportunity_id = NEW.opportunity_id;
  END IF;
  RETURN NEW;
END;
$$;


--
-- Name: skip_paused_submission_queue_item(uuid, uuid, text, uuid); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.skip_paused_submission_queue_item(p_id uuid, p_org_id uuid, p_reason text, p_reviewer_id uuid) RETURNS uuid
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_id uuid;
BEGIN
  UPDATE submission_queue
  SET status = 'skipped',
      paused_history = COALESCE(paused_history, '[]'::jsonb) || jsonb_build_object(
        'action', 'skipped',
        'reason', p_reason,
        'previous_pause_reason', pause_reason,
        'skipped_by', p_reviewer_id,
        'skipped_at', now()
      ),
      pause_reason = NULL,
      paused_at = NULL,
      paused_screenshot_path = NULL
  WHERE id = p_id
    AND organization_id = p_org_id
    AND status = 'paused_verification'
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;


--
-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.apply_rls(wal jsonb, max_record_bytes integer DEFAULT (1024 * 1024)) RETURNS SETOF realtime.wal_rls
    LANGUAGE plpgsql
    AS $$
declare
    -- Regclass of the table e.g. public.notes
    entity_ regclass = (quote_ident(wal ->> 'schema') || '.' || quote_ident(wal ->> 'table'))::regclass;

    -- I, U, D, T: insert, update ...
    action realtime.action = (
        case wal ->> 'action'
            when 'I' then 'INSERT'
            when 'U' then 'UPDATE'
            when 'D' then 'DELETE'
            else 'ERROR'
        end
    );

    -- Is row level security enabled for the table
    is_rls_enabled bool = relrowsecurity from pg_class where oid = entity_;

    subscriptions realtime.subscription[] = array_agg(subs)
        from
            realtime.subscription subs
        where
            subs.entity = entity_
            -- Filter by action early - only get subscriptions interested in this action
            -- action_filter column can be: '*' (all), 'INSERT', 'UPDATE', or 'DELETE'
            and (subs.action_filter = '*' or subs.action_filter = action::text);

    -- Subscription vars
    working_role regrole;
    working_selected_columns text[];
    claimed_role regrole;
    claims jsonb;

    subscription_id uuid;
    subscription_has_access bool;
    visible_to_subscription_ids uuid[] = '{}';

    -- structured info for wal's columns
    columns realtime.wal_column[];
    -- previous identity values for update/delete
    old_columns realtime.wal_column[];

    error_record_exceeds_max_size boolean = octet_length(wal::text) > max_record_bytes;

    -- Primary jsonb output for record
    output jsonb;

    -- Loop record for iterating unique roles (outer loop)
    role_record record;
    -- Loop record for iterating unique selected_columns within a role (inner loop)
    cols_record record;
    -- Subscription ids visible at the role level (before fanning out by selected_columns)
    visible_role_sub_ids uuid[] = '{}';

begin
    perform set_config('role', null, true);

    columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'columns') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    old_columns =
        array_agg(
            (
                x->>'name',
                x->>'type',
                x->>'typeoid',
                realtime.cast(
                    (x->'value') #>> '{}',
                    coalesce(
                        (x->>'typeoid')::regtype, -- null when wal2json version <= 2.4
                        (x->>'type')::regtype
                    )
                ),
                (pks ->> 'name') is not null,
                true
            )::realtime.wal_column
        )
        from
            jsonb_array_elements(wal -> 'identity') x
            left join jsonb_array_elements(wal -> 'pk') pks
                on (x ->> 'name') = (pks ->> 'name');

    for role_record in
        select claims_role
        from (select distinct claims_role from unnest(subscriptions)) t
        order by claims_role::text
    loop
        working_role := role_record.claims_role;

        -- Update `is_selectable` for columns and old_columns (once per role)
        columns =
            array_agg(
                (
                    c.name,
                    c.type_name,
                    c.type_oid,
                    c.value,
                    c.is_pkey,
                    pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                )::realtime.wal_column
            )
            from
                unnest(columns) c;

        old_columns =
                array_agg(
                    (
                        c.name,
                        c.type_name,
                        c.type_oid,
                        c.value,
                        c.is_pkey,
                        pg_catalog.has_column_privilege(working_role, entity_, c.name, 'SELECT')
                    )::realtime.wal_column
                )
                from
                    unnest(old_columns) c;

        if action <> 'DELETE' and count(1) = 0 from unnest(columns) c where c.is_pkey then
            -- Fan out 400 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 400: Bad Request, no primary key']
                )::realtime.wal_rls;
            end loop;

        -- The claims role does not have SELECT permission to the primary key of entity
        elsif action <> 'DELETE' and sum(c.is_selectable::int) <> count(1) from unnest(columns) c where c.is_pkey then
            -- Fan out 401 error per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;
                return next (
                    jsonb_build_object(
                        'schema', wal ->> 'schema',
                        'table', wal ->> 'table',
                        'type', action
                    ),
                    is_rls_enabled,
                    (select array_agg(s.subscription_id) from unnest(subscriptions) as s where s.claims_role = working_role and (s.selected_columns is not distinct from working_selected_columns)),
                    array['Error 401: Unauthorized']
                )::realtime.wal_rls;
            end loop;

        else
            -- Create the prepared statement (once per role)
            if is_rls_enabled and action <> 'DELETE' then
                if (select 1 from pg_prepared_statements where name = 'walrus_rls_stmt' limit 1) > 0 then
                    deallocate walrus_rls_stmt;
                end if;
                execute realtime.build_prepared_statement_sql('walrus_rls_stmt', entity_, columns);
            end if;

            -- Collect all visible subscription IDs for this role (filter check + RLS check)
            visible_role_sub_ids = '{}';

            for subscription_id, claims in (
                    select
                        subs.subscription_id,
                        subs.claims
                    from
                        unnest(subscriptions) subs
                    where
                        subs.entity = entity_
                        and subs.claims_role = working_role
                        and (
                            realtime.is_visible_through_filters(columns, subs.filters)
                            or (
                              action = 'DELETE'
                              and realtime.is_visible_through_filters(old_columns, subs.filters)
                            )
                        )
            ) loop

                if not is_rls_enabled or action = 'DELETE' then
                    visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                else
                    -- Check if RLS allows the role to see the record
                    perform
                        -- Trim leading and trailing quotes from working_role because set_config
                        -- doesn't recognize the role as valid if they are included
                        set_config('role', trim(both '"' from working_role::text), true),
                        set_config('request.jwt.claims', claims::text, true);

                    execute 'execute walrus_rls_stmt' into subscription_has_access;

                    -- Reset the role on every FOR..LOOP batch execution.
                    -- The first batch of 10 rows is pre-fetched using the current connection role (PG internal behaviour)
                    -- then we have to reset it again otherwise it would use the role defined in the `set_config` above
                    -- to fetch the remaining rows when rows>10, which could be a user-defined role that lacks execution grants.
                    -- The flow is:
                    --   1. run batch with conn role
                    --   2. set_config working_role
                    --   3. execute walrus
                    --   4. reset role (revert)
                    --   5. repeat
                    perform set_config('role', null, true);

                    if subscription_has_access then
                        visible_role_sub_ids = visible_role_sub_ids || subscription_id;
                    end if;
                end if;
            end loop;

            perform set_config('role', null, true);

            -- Inner loop: per distinct selected_columns for this role
            for cols_record in
                select selected_columns
                from (select distinct selected_columns from unnest(subscriptions) s where s.claims_role = working_role) t
                order by coalesce(array_to_string(selected_columns, ','), '')
            loop
                working_selected_columns := cols_record.selected_columns;

                output = jsonb_build_object(
                    'schema', wal ->> 'schema',
                    'table', wal ->> 'table',
                    'type', action,
                    'commit_timestamp', to_char(
                        ((wal ->> 'timestamp')::timestamptz at time zone 'utc'),
                        'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
                    ),
                    'columns', (
                        select
                            jsonb_agg(
                                jsonb_build_object(
                                    'name', pa.attname,
                                    'type', pt.typname
                                )
                                order by pa.attnum asc
                            )
                        from
                            pg_attribute pa
                            join pg_type pt
                                on pa.atttypid = pt.oid
                            left join (
                                select unnest(conkey) as pkey_attnum
                                from pg_constraint
                                where conrelid = entity_ and contype = 'p'
                            ) pk on pk.pkey_attnum = pa.attnum
                        where
                            attrelid = entity_
                            and attnum > 0
                            and pg_catalog.has_column_privilege(working_role, entity_, pa.attname, 'SELECT')
                            and (working_selected_columns is null or pa.attname = any(working_selected_columns) or pk.pkey_attnum is not null)
                    )
                )
                -- Add "record" key for insert and update
                || case
                    when action in ('INSERT', 'UPDATE') then
                        jsonb_build_object(
                            'record',
                            (
                                select
                                    jsonb_object_agg(
                                        -- if unchanged toast, get column name and value from old record
                                        coalesce((c).name, (oc).name),
                                        case
                                            when (c).name is null then (oc).value
                                            else (c).value
                                        end
                                    )
                                from
                                    unnest(columns) c
                                    full outer join unnest(old_columns) oc
                                        on (c).name = (oc).name
                                where
                                    coalesce((c).is_selectable, (oc).is_selectable)
                                    and (working_selected_columns is null or coalesce((c).name, (oc).name) = any(working_selected_columns) or coalesce((c).is_pkey, (oc).is_pkey))
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                            )
                        )
                    else '{}'::jsonb
                end
                -- Add "old_record" key for update and delete
                || case
                    when action = 'UPDATE' then
                        jsonb_build_object(
                                'old_record',
                                (
                                    select jsonb_object_agg((c).name, (c).value)
                                    from unnest(old_columns) c
                                    where
                                        (c).is_selectable
                                        and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                        and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                )
                            )
                    when action = 'DELETE' then
                        jsonb_build_object(
                            'old_record',
                            (
                                select jsonb_object_agg((c).name, (c).value)
                                from unnest(old_columns) c
                                where
                                    (c).is_selectable
                                    and (working_selected_columns is null or (c).name = any(working_selected_columns) or (c).is_pkey)
                                    and ( not error_record_exceeds_max_size or (octet_length((c).value::text) <= 64))
                                    and ( not is_rls_enabled or (c).is_pkey ) -- if RLS enabled, we can't secure deletes so filter to pkey
                            )
                        )
                    else '{}'::jsonb
                end;

                -- Filter visible_role_sub_ids to those matching the current selected_columns group
                visible_to_subscription_ids = coalesce(
                    (
                        select array_agg(s.subscription_id)
                        from unnest(subscriptions) s
                        where s.claims_role = working_role
                          and (s.selected_columns is not distinct from working_selected_columns)
                          and s.subscription_id = any(visible_role_sub_ids)
                    ),
                    '{}'::uuid[]
                );

                return next (
                    output,
                    is_rls_enabled,
                    visible_to_subscription_ids,
                    case
                        when error_record_exceeds_max_size then array['Error 413: Payload Too Large']
                        else '{}'
                    end
                )::realtime.wal_rls;
            end loop;

        end if;
    end loop;

    perform set_config('role', null, true);
end;
$$;


--
-- Name: broadcast_changes(text, text, text, text, text, record, record, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.broadcast_changes(topic_name text, event_name text, operation text, table_name text, table_schema text, new record, old record, level text DEFAULT 'ROW'::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
    -- Declare a variable to hold the JSONB representation of the row
    row_data jsonb := '{}'::jsonb;
BEGIN
    IF level = 'STATEMENT' THEN
        RAISE EXCEPTION 'function can only be triggered for each row, not for each statement';
    END IF;
    -- Check the operation type and handle accordingly
    IF operation = 'INSERT' OR operation = 'UPDATE' OR operation = 'DELETE' THEN
        row_data := jsonb_build_object('old_record', OLD, 'record', NEW, 'operation', operation, 'table', table_name, 'schema', table_schema);
        PERFORM realtime.send (row_data, event_name, topic_name);
    ELSE
        RAISE EXCEPTION 'Unexpected operation type: %', operation;
    END IF;
EXCEPTION
    WHEN OTHERS THEN
        RAISE EXCEPTION 'Failed to process the row: %', SQLERRM;
END;

$$;


--
-- Name: build_prepared_statement_sql(text, regclass, realtime.wal_column[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.build_prepared_statement_sql(prepared_statement_name text, entity regclass, columns realtime.wal_column[]) RETURNS text
    LANGUAGE sql
    AS $$
      /*
      Builds a sql string that, if executed, creates a prepared statement to
      tests retrive a row from *entity* by its primary key columns.
      Example
          select realtime.build_prepared_statement_sql('public.notes', '{"id"}'::text[], '{"bigint"}'::text[])
      */
          select
      'prepare ' || prepared_statement_name || ' as
          select
              exists(
                  select
                      1
                  from
                      ' || entity || '
                  where
                      ' || string_agg(quote_ident(pkc.name) || '=' || quote_nullable(pkc.value #>> '{}') , ' and ') || '
              )'
          from
              unnest(columns) pkc
          where
              pkc.is_pkey
          group by
              entity
      $$;


--
-- Name: cast(text, regtype); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime."cast"(val text, type_ regtype) RETURNS jsonb
    LANGUAGE plpgsql IMMUTABLE
    AS $$
declare
  res jsonb;
begin
  if type_::text = 'bytea' then
    return to_jsonb(val);
  end if;
  execute format('select to_jsonb(%L::'|| type_::text || ')', val) into res;
  return res;
end
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text) RETURNS boolean
    LANGUAGE plpgsql IMMUTABLE
    AS $$
/*
Casts *val_1* and *val_2* as type *type_* and check the *op* condition for truthiness
*/
declare
    op_symbol text = (
        case
            when op = 'eq' then '='
            when op = 'neq' then '!='
            when op = 'lt' then '<'
            when op = 'lte' then '<='
            when op = 'gt' then '>'
            when op = 'gte' then '>='
            when op = 'in' then '= any'
            else 'UNKNOWN OP'
        end
    );
    res boolean;
begin
    execute format(
        'select %L::'|| type_::text || ' ' || op_symbol
        || ' ( %L::'
        || (
            case
                when op = 'in' then type_::text || '[]'
                else type_::text end
        )
        || ')', val_1, val_2) into res;
    return res;
end;
$$;


--
-- Name: check_equality_op(realtime.equality_op, regtype, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.check_equality_op(op realtime.equality_op, type_ regtype, val_1 text, val_2 text, negate boolean) RETURNS boolean
    LANGUAGE plpgsql STABLE
    AS $$
declare
    op_symbol text;
    res boolean;
begin
    -- IS DISTINCT FROM / IS NOT DISTINCT FROM: infix, both sides typed literals
    if op = 'isdistinct' then
        execute format(
            'select %L::%s %s %L::%s',
            val_1,
            type_::text,
            case when negate then 'IS NOT DISTINCT FROM' else 'IS DISTINCT FROM' end,
            val_2,
            type_::text
        ) into res;
        return res;
    end if;

    -- IS requires a keyword RHS (NULL, TRUE, FALSE, UNKNOWN), not a typed literal
    if op = 'is' then
        if val_2 not in ('null', 'true', 'false', 'unknown') then
            raise exception 'invalid value for is filter: must be null, true, false, or unknown';
        end if;
        execute format(
            'select %L::%s %s %s',
            val_1,
            type_::text,
            case when negate then 'IS NOT' else 'IS' end,
            upper(val_2)
        ) into res;
        return res;
    end if;

    op_symbol = case
        when op = 'eq'    then '='
        when op = 'neq'   then '!='
        when op = 'lt'    then '<'
        when op = 'lte'   then '<='
        when op = 'gt'    then '>'
        when op = 'gte'   then '>='
        when op = 'in'    then '= any'
        when op = 'like'   then 'LIKE'
        when op = 'ilike'  then 'ILIKE'
        when op = 'match'  then '~'
        when op = 'imatch' then '~*'
        else null
    end;

    if op_symbol is null then
        raise exception 'unsupported equality operator: %', op::text;
    end if;

    execute format(
        'select %L::%s %s (%L::%s)',
        val_1,
        type_::text,
        op_symbol,
        val_2,
        case when op = 'in' then type_::text || '[]' else type_::text end
    ) into res;

    return case when negate then not res else res end;
end;
$$;


--
-- Name: is_visible_through_filters(realtime.wal_column[], realtime.user_defined_filter[]); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.is_visible_through_filters(columns realtime.wal_column[], filters realtime.user_defined_filter[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
    select
        filters is null
        or array_length(filters, 1) is null
        or coalesce(
            count(col.name) = count(1)
            and sum(
                realtime.check_equality_op(
                    op:=f.op,
                    type_:=coalesce(col.type_oid::regtype, col.type_name::regtype),
                    val_1:=col.value #>> '{}',
                    val_2:=f.value,
                    negate:=coalesce(f.negate, false)
                )::int
            ) filter (where col.name is not null) = count(col.name),
            false
        )
    from
        unnest(filters) f
        left join unnest(columns) col
            on f.column_name = col.name;
$$;


--
-- Name: list_changes(name, name, integer, integer); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.list_changes(publication name, slot_name name, max_changes integer, max_record_bytes integer) RETURNS TABLE(wal jsonb, is_rls_enabled boolean, subscription_ids uuid[], errors text[], slot_changes_count bigint)
    LANGUAGE sql
    SET log_min_messages TO 'fatal'
    AS $$
  WITH pub AS (
    SELECT
      concat_ws(
        ',',
        CASE WHEN bool_or(pubinsert) THEN 'insert' ELSE NULL END,
        CASE WHEN bool_or(pubupdate) THEN 'update' ELSE NULL END,
        CASE WHEN bool_or(pubdelete) THEN 'delete' ELSE NULL END
      ) AS w2j_actions,
      coalesce(
        string_agg(
          realtime.quote_wal2json(format('%I.%I', schemaname, tablename)::regclass),
          ','
        ) filter (WHERE ppt.tablename IS NOT NULL),
        ''
      ) AS w2j_add_tables
    FROM pg_publication pp
    LEFT JOIN pg_publication_tables ppt ON pp.pubname = ppt.pubname
    WHERE pp.pubname = publication
    GROUP BY pp.pubname
    LIMIT 1
  ),
  -- MATERIALIZED ensures pg_logical_slot_get_changes is called exactly once
  w2j AS MATERIALIZED (
    SELECT x.*, pub.w2j_add_tables
    FROM pub,
         pg_logical_slot_get_changes(
           slot_name, null, max_changes,
           'include-pk', 'true',
           'include-transaction', 'false',
           'include-timestamp', 'true',
           'include-type-oids', 'true',
           'format-version', '2',
           'actions', pub.w2j_actions,
           'add-tables', pub.w2j_add_tables
         ) x
  ),
  slot_count AS (
    SELECT count(*)::bigint AS cnt
    FROM w2j
    WHERE w2j.w2j_add_tables <> ''
  ),
  rls_filtered AS (
    SELECT xyz.wal, xyz.is_rls_enabled, xyz.subscription_ids, xyz.errors
    FROM w2j,
         realtime.apply_rls(
           wal := w2j.data::jsonb,
           max_record_bytes := max_record_bytes
         ) xyz(wal, is_rls_enabled, subscription_ids, errors)
    WHERE w2j.w2j_add_tables <> ''
      AND xyz.subscription_ids[1] IS NOT NULL
  )
  SELECT rf.wal, rf.is_rls_enabled, rf.subscription_ids, rf.errors, sc.cnt
  FROM rls_filtered rf, slot_count sc

  UNION ALL

  SELECT null, null, null, null, sc.cnt
  FROM slot_count sc
  WHERE NOT EXISTS (SELECT 1 FROM rls_filtered)
$$;


--
-- Name: quote_wal2json(regclass); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.quote_wal2json(entity regclass) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  SELECT
    realtime.wal2json_escape_identifier(nsp.nspname::text)
    || '.'
    || realtime.wal2json_escape_identifier(pc.relname::text)
  FROM pg_class pc
  JOIN pg_namespace nsp ON pc.relnamespace = nsp.oid
  WHERE pc.oid = entity
$$;


--
-- Name: send(jsonb, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.send(payload jsonb, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
  final_payload jsonb;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    -- Check if payload has an 'id' key, if not, add the generated UUID
    IF payload ? 'id' THEN
      final_payload := payload;
    ELSE
      final_payload := jsonb_set(payload, '{id}', to_jsonb(generated_id));
    END IF;

    -- Set the topic configuration
    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, payload, event, topic, private, extension)
    VALUES (generated_id, final_payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: send_binary(bytea, text, text, boolean); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.send_binary(payload bytea, event text, topic text, private boolean DEFAULT true) RETURNS void
    LANGUAGE plpgsql
    AS $$
DECLARE
  generated_id uuid;
BEGIN
  BEGIN
    generated_id := gen_random_uuid();

    EXECUTE format('SET LOCAL realtime.topic TO %L', topic);

    INSERT INTO realtime.messages (id, binary_payload, event, topic, private, extension)
    VALUES (generated_id, payload, event, topic, private, 'broadcast');
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING 'WarnSendingBroadcastMessage: %', SQLERRM;
  END;
END;
$$;


--
-- Name: subscription_check_filters(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.subscription_check_filters() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
declare
    col_names text[] = coalesce(
            array_agg(a.attname order by a.attnum),
            '{}'::text[]
        )
        from
            pg_catalog.pg_attribute a
        where
            a.attrelid = new.entity
            and a.attnum > 0
            and not a.attisdropped
            and pg_catalog.has_column_privilege(
                (new.claims ->> 'role'),
                a.attrelid,
                a.attnum,
                'SELECT'
            );
    filter realtime.user_defined_filter;
    col_type regtype;
    in_val jsonb;
    selected_col text;
begin
    for filter in select * from unnest(new.filters) loop
        if not filter.column_name = any(col_names) then
            raise exception 'invalid column for filter %', filter.column_name;
        end if;

        col_type = (
            select atttypid::regtype
            from pg_catalog.pg_attribute
            where attrelid = new.entity
                  and attname = filter.column_name
        );
        if col_type is null then
            raise exception 'failed to lookup type for column %', filter.column_name;
        end if;

        if filter.op = 'in'::realtime.equality_op then
            in_val = realtime.cast(filter.value, (col_type::text || '[]')::regtype);
            if coalesce(jsonb_array_length(in_val), 0) > 100 then
                raise exception 'too many values for `in` filter. Maximum 100';
            end if;
        elsif filter.op = 'is'::realtime.equality_op then
            -- `is` requires a keyword RHS rather than a typed literal
            if filter.value not in ('null', 'true', 'false', 'unknown') then
                raise exception 'invalid value for is filter: must be null, true, false, or unknown';
            end if;
            -- IS NULL works for any type, but IS TRUE/FALSE/UNKNOWN require a boolean
            -- operand. Reject the non-null keywords on non-boolean columns here so they
            -- don't abort apply_rls at WAL time.
            if filter.value <> 'null' and col_type <> 'boolean'::regtype then
                raise exception 'is % filter requires a boolean column, got %', filter.value, col_type::text;
            end if;
        elsif filter.op in ('like'::realtime.equality_op, 'ilike'::realtime.equality_op) then
            -- like/ilike apply the text pattern operator (~~); reject column types that
            -- have no such operator instead of failing at WAL time
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = '~~' and oprleft = col_type
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
        elsif filter.op in ('match'::realtime.equality_op, 'imatch'::realtime.equality_op) then
            -- match/imatch apply the regex operators ~ / ~*; reject column types that have
            -- no such operator (e.g. integer) instead of failing at WAL time, mirroring the
            -- like/ilike guard above.
            if not exists (
                select 1 from pg_catalog.pg_operator
                where oprname = case when filter.op = 'imatch'::realtime.equality_op then '~*' else '~' end
                  and oprleft = col_type
                  and oprright = col_type
                  and oprresult = 'boolean'::regtype
            ) then
                raise exception 'operator % requires a text-compatible column type, got %', filter.op::text, col_type::text;
            end if;
            -- validate the regex eagerly so a bad pattern is rejected here, not inside
            -- apply_rls where it would abort the WAL stream for the entity
            begin
                perform '' ~ filter.value;
            exception when others then
                raise exception 'invalid regular expression for % filter: %', filter.op::text, sqlerrm;
            end;
        else
            -- eq/neq/lt/lte/gt/gte: value must be coercable to the type
            perform realtime.cast(filter.value, col_type);
        end if;
    end loop;

    if new.selected_columns is not null then
        for selected_col in select * from unnest(new.selected_columns) loop
            if not selected_col = any(col_names) then
                raise exception 'invalid column for select %', selected_col;
            end if;
        end loop;
    end if;

    -- Apply consistent order to filters so the unique constraint can't be tricked by a
    -- different filter order. negate is part of the sort key.
    new.filters = coalesce(
        array_agg(f order by f.column_name, f.op, f.value, f.negate),
        '{}'
    ) from unnest(new.filters) f;

    new.selected_columns = (
        select array_agg(c order by c)
        from unnest(new.selected_columns) c
    );

    return new;
end;
$$;


--
-- Name: to_regrole(text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.to_regrole(role_name text) RETURNS regrole
    LANGUAGE sql IMMUTABLE
    AS $$ select role_name::regrole $$;


--
-- Name: topic(); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.topic() RETURNS text
    LANGUAGE sql STABLE
    AS $$
select nullif(current_setting('realtime.topic', true), '')::text;
$$;


--
-- Name: wal2json_escape_identifier(text); Type: FUNCTION; Schema: realtime; Owner: -
--

CREATE FUNCTION realtime.wal2json_escape_identifier(name text) RETURNS text
    LANGUAGE sql IMMUTABLE STRICT
    AS $$
  -- Prefix `\`, `,`, `.`, and any whitespace with `\`
  SELECT regexp_replace(name, '([\\,.[:space:]])', '\\\1', 'g')
$$;


--
-- Name: allow_any_operation(text[]); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_any_operation(expected_operations text[]) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT CASE
      WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
      ELSE raw_operation
    END AS current_operation
    FROM current_operation
  )
  SELECT EXISTS (
    SELECT 1
    FROM normalized n
    CROSS JOIN LATERAL unnest(expected_operations) AS expected_operation
    WHERE expected_operation IS NOT NULL
      AND expected_operation <> ''
      AND n.current_operation = CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END
  );
$$;


--
-- Name: allow_only_operation(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.allow_only_operation(expected_operation text) RETURNS boolean
    LANGUAGE sql STABLE
    AS $$
  WITH current_operation AS (
    SELECT storage.operation() AS raw_operation
  ),
  normalized AS (
    SELECT
      CASE
        WHEN raw_operation LIKE 'storage.%' THEN substr(raw_operation, 9)
        ELSE raw_operation
      END AS current_operation,
      CASE
        WHEN expected_operation LIKE 'storage.%' THEN substr(expected_operation, 9)
        ELSE expected_operation
      END AS requested_operation
    FROM current_operation
  )
  SELECT CASE
    WHEN requested_operation IS NULL OR requested_operation = '' THEN FALSE
    ELSE COALESCE(current_operation = requested_operation, FALSE)
  END
  FROM normalized;
$$;


--
-- Name: can_insert_object(text, text, uuid, jsonb); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.can_insert_object(bucketid text, name text, owner uuid, metadata jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO "storage"."objects" ("bucket_id", "name", "owner", "metadata") VALUES (bucketid, name, owner, metadata);
  -- hack to rollback the successful insert
  RAISE sqlstate 'PT200' using
  message = 'ROLLBACK',
  detail = 'rollback successful insert';
END
$$;


--
-- Name: enforce_bucket_name_length(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.enforce_bucket_name_length() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
begin
    if length(new.name) > 100 then
        raise exception 'bucket name "%" is too long (% characters). Max is 100.', new.name, length(new.name);
    end if;
    return new;
end;
$$;


--
-- Name: extension(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.extension(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
    _filename text;
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Get the last path segment (the actual filename)
    SELECT _parts[array_length(_parts, 1)] INTO _filename;
    -- Extract extension: reverse, split on '.', then reverse again
    RETURN reverse(split_part(reverse(_filename), '.', 1));
END
$$;


--
-- Name: filename(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.filename(name text) RETURNS text
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    SELECT string_to_array(name, '/') INTO _parts;
    RETURN _parts[array_length(_parts, 1)];
END
$$;


--
-- Name: foldername(text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.foldername(name text) RETURNS text[]
    LANGUAGE plpgsql IMMUTABLE
    AS $$
DECLARE
    _parts text[];
BEGIN
    -- Split on "/" to get path segments
    SELECT string_to_array(name, '/') INTO _parts;
    -- Return everything except the last segment
    RETURN _parts[1 : array_length(_parts,1) - 1];
END
$$;


--
-- Name: get_common_prefix(text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_common_prefix(p_key text, p_prefix text, p_delimiter text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $$
SELECT CASE
    WHEN position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)) > 0
    THEN left(p_key, length(p_prefix) + position(p_delimiter IN substring(p_key FROM length(p_prefix) + 1)))
    ELSE NULL
END;
$$;


--
-- Name: get_size_by_bucket(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.get_size_by_bucket() RETURNS TABLE(size bigint, bucket_id text)
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    return query
        select sum((metadata->>'size')::bigint)::bigint as size, obj.bucket_id
        from "storage".objects as obj
        group by obj.bucket_id;
END
$$;


--
-- Name: list_multipart_uploads_with_delimiter(text, text, text, integer, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_multipart_uploads_with_delimiter(bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, next_key_token text DEFAULT ''::text, next_upload_token text DEFAULT ''::text) RETURNS TABLE(key text, id text, created_at timestamp with time zone)
    LANGUAGE plpgsql
    AS $_$
BEGIN
    RETURN QUERY EXECUTE
        'SELECT DISTINCT ON(key COLLATE "C") * from (
            SELECT
                CASE
                    WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                        substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1)))
                    ELSE
                        key
                END AS key, id, created_at
            FROM
                storage.s3_multipart_uploads
            WHERE
                bucket_id = $5 AND
                key ILIKE $1 || ''%'' AND
                CASE
                    WHEN $4 != '''' AND $6 = '''' THEN
                        CASE
                            WHEN position($2 IN substring(key from length($1) + 1)) > 0 THEN
                                substring(key from 1 for length($1) + position($2 IN substring(key from length($1) + 1))) COLLATE "C" > $4
                            ELSE
                                key COLLATE "C" > $4
                            END
                    ELSE
                        true
                END AND
                CASE
                    WHEN $6 != '''' THEN
                        id COLLATE "C" > $6
                    ELSE
                        true
                    END
            ORDER BY
                key COLLATE "C" ASC, created_at ASC) as e order by key COLLATE "C" LIMIT $3'
        USING prefix_param, delimiter_param, max_keys, next_key_token, bucket_id, next_upload_token;
END;
$_$;


--
-- Name: list_objects_with_delimiter(text, text, text, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.list_objects_with_delimiter(_bucket_id text, prefix_param text, delimiter_param text, max_keys integer DEFAULT 100, start_after text DEFAULT ''::text, next_token text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, metadata jsonb, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;

    -- Configuration
    v_is_asc BOOLEAN;
    v_prefix TEXT;
    v_start TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_is_asc := lower(coalesce(sort_order, 'asc')) = 'asc';
    v_prefix := coalesce(prefix_param, '');
    v_start := CASE WHEN coalesce(next_token, '') <> '' THEN next_token ELSE coalesce(start_after, '') END;
    v_file_batch_size := LEAST(GREATEST(max_keys * 2, 100), 1000);

    -- Calculate upper bound for prefix filtering (bytewise, using COLLATE "C")
    IF v_prefix = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix, 1) = delimiter_param THEN
        v_upper_bound := left(v_prefix, -1) || chr(ascii(delimiter_param) + 1);
    ELSE
        v_upper_bound := left(v_prefix, -1) || chr(ascii(right(v_prefix, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'AND o.name COLLATE "C" < $3 ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" >= $2 ' ||
                'ORDER BY o.name COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'AND o.name COLLATE "C" >= $3 ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND o.name COLLATE "C" < $2 ' ||
                'ORDER BY o.name COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- ========================================================================
    -- SEEK INITIALIZATION: Determine starting position
    -- ========================================================================
    IF v_start = '' THEN
        IF v_is_asc THEN
            v_next_seek := v_prefix;
        ELSE
            -- DESC without cursor: find the last item in range
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_next_seek FROM storage.objects o
                WHERE o.bucket_id = _bucket_id
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;

            IF v_next_seek IS NOT NULL THEN
                v_next_seek := v_next_seek || delimiter_param;
            ELSE
                RETURN;
            END IF;
        END IF;
    ELSE
        -- Cursor provided: determine if it refers to a folder or leaf
        IF EXISTS (
            SELECT 1 FROM storage.objects o
            WHERE o.bucket_id = _bucket_id
              AND o.name COLLATE "C" LIKE v_start || delimiter_param || '%'
            LIMIT 1
        ) THEN
            -- Cursor refers to a folder
            IF v_is_asc THEN
                v_next_seek := v_start || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_start || delimiter_param;
            END IF;
        ELSE
            -- Cursor refers to a leaf object
            IF v_is_asc THEN
                v_next_seek := v_start || delimiter_param;
            ELSE
                v_next_seek := v_start;
            END IF;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= max_keys;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek AND o.name COLLATE "C" < v_upper_bound
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" >= v_next_seek
                ORDER BY o.name COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek AND o.name COLLATE "C" >= v_prefix
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = _bucket_id AND o.name COLLATE "C" < v_next_seek
                ORDER BY o.name COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(v_peek_name, v_prefix, delimiter_param);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Emit and skip to next folder (no heap access needed)
            name := rtrim(v_common_prefix, delimiter_param);
            id := NULL;
            updated_at := NULL;
            created_at := NULL;
            last_accessed_at := NULL;
            metadata := NULL;
            RETURN NEXT;
            v_count := v_count + 1;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := left(v_common_prefix, -1) || chr(ascii(delimiter_param) + 1);
            ELSE
                v_next_seek := v_common_prefix;
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query USING _bucket_id, v_next_seek,
                CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix) ELSE v_prefix END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(v_current.name, v_prefix, delimiter_param);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := v_current.name;
                    EXIT;
                END IF;

                -- Emit file
                name := v_current.name;
                id := v_current.id;
                updated_at := v_current.updated_at;
                created_at := v_current.created_at;
                last_accessed_at := v_current.last_accessed_at;
                metadata := v_current.metadata;
                RETURN NEXT;
                v_count := v_count + 1;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := v_current.name || delimiter_param;
                ELSE
                    v_next_seek := v_current.name;
                END IF;

                EXIT WHEN v_count >= max_keys;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: operation(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.operation() RETURNS text
    LANGUAGE plpgsql STABLE
    AS $$
BEGIN
    RETURN current_setting('storage.operation', true);
END;
$$;


--
-- Name: protect_delete(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.protect_delete() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    -- Check if storage.allow_delete_query is set to 'true'
    IF COALESCE(current_setting('storage.allow_delete_query', true), 'false') != 'true' THEN
        RAISE EXCEPTION 'Direct deletion from storage tables is not allowed. Use the Storage API instead.'
            USING HINT = 'This prevents accidental data loss from orphaned objects.',
                  ERRCODE = '42501';
    END IF;
    RETURN NULL;
END;
$$;


--
-- Name: search(text, text, integer, integer, integer, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search(prefix text, bucketname text, limits integer DEFAULT 100, levels integer DEFAULT 1, offsets integer DEFAULT 0, search text DEFAULT ''::text, sortcolumn text DEFAULT 'name'::text, sortorder text DEFAULT 'asc'::text) RETURNS TABLE(name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_peek_name TEXT;
    v_current RECORD;
    v_common_prefix TEXT;
    v_delimiter CONSTANT TEXT := '/';

    -- Configuration
    v_limit INT;
    v_prefix TEXT;
    v_prefix_lower TEXT;
    v_is_asc BOOLEAN;
    v_order_by TEXT;
    v_sort_order TEXT;
    v_upper_bound TEXT;
    v_file_batch_size INT;

    -- Dynamic SQL for batch query only
    v_batch_query TEXT;

    -- Seek state
    v_next_seek TEXT;
    v_count INT := 0;
    v_skipped INT := 0;
BEGIN
    -- ========================================================================
    -- INITIALIZATION
    -- ========================================================================
    v_limit := LEAST(coalesce(limits, 100), 1500);
    v_prefix := coalesce(prefix, '') || coalesce(search, '');
    v_prefix_lower := lower(v_prefix);
    v_is_asc := lower(coalesce(sortorder, 'asc')) = 'asc';
    v_file_batch_size := LEAST(GREATEST(v_limit * 2, 100), 1000);

    -- Validate sort column
    CASE lower(coalesce(sortcolumn, 'name'))
        WHEN 'name' THEN v_order_by := 'name';
        WHEN 'updated_at' THEN v_order_by := 'updated_at';
        WHEN 'created_at' THEN v_order_by := 'created_at';
        WHEN 'last_accessed_at' THEN v_order_by := 'last_accessed_at';
        ELSE v_order_by := 'name';
    END CASE;

    v_sort_order := CASE WHEN v_is_asc THEN 'asc' ELSE 'desc' END;

    -- ========================================================================
    -- NON-NAME SORTING: Use path_tokens approach (unchanged)
    -- ========================================================================
    IF v_order_by != 'name' THEN
        RETURN QUERY EXECUTE format(
            $sql$
            WITH folders AS (
                SELECT path_tokens[$1] AS folder
                FROM storage.objects
                WHERE objects.name ILIKE $2 || '%%'
                  AND bucket_id = $3
                  AND array_length(objects.path_tokens, 1) <> $1
                GROUP BY folder
                ORDER BY folder %s
            )
            (SELECT folder AS "name",
                   NULL::uuid AS id,
                   NULL::timestamptz AS updated_at,
                   NULL::timestamptz AS created_at,
                   NULL::timestamptz AS last_accessed_at,
                   NULL::jsonb AS metadata FROM folders)
            UNION ALL
            (SELECT path_tokens[$1] AS "name",
                   id, updated_at, created_at, last_accessed_at, metadata
             FROM storage.objects
             WHERE objects.name ILIKE $2 || '%%'
               AND bucket_id = $3
               AND array_length(objects.path_tokens, 1) = $1
             ORDER BY %I %s)
            LIMIT $4 OFFSET $5
            $sql$, v_sort_order, v_order_by, v_sort_order
        ) USING levels, v_prefix, bucketname, v_limit, offsets;
        RETURN;
    END IF;

    -- ========================================================================
    -- NAME SORTING: Hybrid skip-scan with batch optimization
    -- ========================================================================

    -- Calculate upper bound for prefix filtering
    IF v_prefix_lower = '' THEN
        v_upper_bound := NULL;
    ELSIF right(v_prefix_lower, 1) = v_delimiter THEN
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(v_delimiter) + 1);
    ELSE
        v_upper_bound := left(v_prefix_lower, -1) || chr(ascii(right(v_prefix_lower, 1)) + 1);
    END IF;

    -- Build batch query (dynamic SQL - called infrequently, amortized over many rows)
    IF v_is_asc THEN
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'AND lower(o.name) COLLATE "C" < $3 ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" >= $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" ASC LIMIT $4';
        END IF;
    ELSE
        IF v_upper_bound IS NOT NULL THEN
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'AND lower(o.name) COLLATE "C" >= $3 ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        ELSE
            v_batch_query := 'SELECT o.name, o.id, o.updated_at, o.created_at, o.last_accessed_at, o.metadata ' ||
                'FROM storage.objects o WHERE o.bucket_id = $1 AND lower(o.name) COLLATE "C" < $2 ' ||
                'ORDER BY lower(o.name) COLLATE "C" DESC LIMIT $4';
        END IF;
    END IF;

    -- Initialize seek position
    IF v_is_asc THEN
        v_next_seek := v_prefix_lower;
    ELSE
        -- DESC: find the last item in range first (static SQL)
        IF v_upper_bound IS NOT NULL THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower AND lower(o.name) COLLATE "C" < v_upper_bound
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSIF v_prefix_lower <> '' THEN
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_prefix_lower
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        ELSE
            SELECT o.name INTO v_peek_name FROM storage.objects o
            WHERE o.bucket_id = bucketname
            ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
        END IF;

        IF v_peek_name IS NOT NULL THEN
            v_next_seek := lower(v_peek_name) || v_delimiter;
        ELSE
            RETURN;
        END IF;
    END IF;

    -- ========================================================================
    -- MAIN LOOP: Hybrid peek-then-batch algorithm
    -- Uses STATIC SQL for peek (hot path) and DYNAMIC SQL for batch
    -- ========================================================================
    LOOP
        EXIT WHEN v_count >= v_limit;

        -- STEP 1: PEEK using STATIC SQL (plan cached, very fast)
        IF v_is_asc THEN
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek AND lower(o.name) COLLATE "C" < v_upper_bound
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" >= v_next_seek
                ORDER BY lower(o.name) COLLATE "C" ASC LIMIT 1;
            END IF;
        ELSE
            IF v_upper_bound IS NOT NULL THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSIF v_prefix_lower <> '' THEN
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek AND lower(o.name) COLLATE "C" >= v_prefix_lower
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            ELSE
                SELECT o.name INTO v_peek_name FROM storage.objects o
                WHERE o.bucket_id = bucketname AND lower(o.name) COLLATE "C" < v_next_seek
                ORDER BY lower(o.name) COLLATE "C" DESC LIMIT 1;
            END IF;
        END IF;

        EXIT WHEN v_peek_name IS NULL;

        -- STEP 2: Check if this is a FOLDER or FILE
        v_common_prefix := storage.get_common_prefix(lower(v_peek_name), v_prefix_lower, v_delimiter);

        IF v_common_prefix IS NOT NULL THEN
            -- FOLDER: Handle offset, emit if needed, skip to next folder
            IF v_skipped < offsets THEN
                v_skipped := v_skipped + 1;
            ELSE
                name := split_part(rtrim(storage.get_common_prefix(v_peek_name, v_prefix, v_delimiter), v_delimiter), v_delimiter, levels);
                id := NULL;
                updated_at := NULL;
                created_at := NULL;
                last_accessed_at := NULL;
                metadata := NULL;
                RETURN NEXT;
                v_count := v_count + 1;
            END IF;

            -- Advance seek past the folder range
            IF v_is_asc THEN
                v_next_seek := lower(left(v_common_prefix, -1)) || chr(ascii(v_delimiter) + 1);
            ELSE
                v_next_seek := lower(v_common_prefix);
            END IF;
        ELSE
            -- FILE: Batch fetch using DYNAMIC SQL (overhead amortized over many rows)
            -- For ASC: upper_bound is the exclusive upper limit (< condition)
            -- For DESC: prefix_lower is the inclusive lower limit (>= condition)
            FOR v_current IN EXECUTE v_batch_query
                USING bucketname, v_next_seek,
                    CASE WHEN v_is_asc THEN COALESCE(v_upper_bound, v_prefix_lower) ELSE v_prefix_lower END, v_file_batch_size
            LOOP
                v_common_prefix := storage.get_common_prefix(lower(v_current.name), v_prefix_lower, v_delimiter);

                IF v_common_prefix IS NOT NULL THEN
                    -- Hit a folder: exit batch, let peek handle it
                    v_next_seek := lower(v_current.name);
                    EXIT;
                END IF;

                -- Handle offset skipping
                IF v_skipped < offsets THEN
                    v_skipped := v_skipped + 1;
                ELSE
                    -- Emit file
                    name := split_part(v_current.name, v_delimiter, levels);
                    id := v_current.id;
                    updated_at := v_current.updated_at;
                    created_at := v_current.created_at;
                    last_accessed_at := v_current.last_accessed_at;
                    metadata := v_current.metadata;
                    RETURN NEXT;
                    v_count := v_count + 1;
                END IF;

                -- Advance seek past this file
                IF v_is_asc THEN
                    v_next_seek := lower(v_current.name) || v_delimiter;
                ELSE
                    v_next_seek := lower(v_current.name);
                END IF;

                EXIT WHEN v_count >= v_limit;
            END LOOP;
        END IF;
    END LOOP;
END;
$_$;


--
-- Name: search_by_timestamp(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_by_timestamp(p_prefix text, p_bucket_id text, p_limit integer, p_level integer, p_start_after text, p_sort_order text, p_sort_column text, p_sort_column_after text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $_$
DECLARE
    v_cursor_op text;
    v_query text;
    v_prefix text;
BEGIN
    v_prefix := coalesce(p_prefix, '');

    IF p_sort_order = 'asc' THEN
        v_cursor_op := '>';
    ELSE
        v_cursor_op := '<';
    END IF;

    v_query := format($sql$
        WITH raw_objects AS (
            SELECT
                o.name AS obj_name,
                o.id AS obj_id,
                o.updated_at AS obj_updated_at,
                o.created_at AS obj_created_at,
                o.last_accessed_at AS obj_last_accessed_at,
                o.metadata AS obj_metadata,
                storage.get_common_prefix(o.name, $1, '/') AS common_prefix
            FROM storage.objects o
            WHERE o.bucket_id = $2
              AND o.name COLLATE "C" LIKE $1 || '%%'
        ),
        -- Aggregate common prefixes (folders)
        -- Both created_at and updated_at use MIN(obj_created_at) to match the old prefixes table behavior
        aggregated_prefixes AS (
            SELECT
                rtrim(common_prefix, '/') AS name,
                NULL::uuid AS id,
                MIN(obj_created_at) AS updated_at,
                MIN(obj_created_at) AS created_at,
                NULL::timestamptz AS last_accessed_at,
                NULL::jsonb AS metadata,
                TRUE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NOT NULL
            GROUP BY common_prefix
        ),
        leaf_objects AS (
            SELECT
                obj_name AS name,
                obj_id AS id,
                obj_updated_at AS updated_at,
                obj_created_at AS created_at,
                obj_last_accessed_at AS last_accessed_at,
                obj_metadata AS metadata,
                FALSE AS is_prefix
            FROM raw_objects
            WHERE common_prefix IS NULL
        ),
        combined AS (
            SELECT * FROM aggregated_prefixes
            UNION ALL
            SELECT * FROM leaf_objects
        ),
        filtered AS (
            SELECT *
            FROM combined
            WHERE (
                $5 = ''
                OR ROW(
                    date_trunc('milliseconds', %I),
                    name COLLATE "C"
                ) %s ROW(
                    COALESCE(NULLIF($6, '')::timestamptz, 'epoch'::timestamptz),
                    $5
                )
            )
        )
        SELECT
            split_part(name, '/', $3) AS key,
            name,
            id,
            updated_at,
            created_at,
            last_accessed_at,
            metadata
        FROM filtered
        ORDER BY
            COALESCE(date_trunc('milliseconds', %I), 'epoch'::timestamptz) %s,
            name COLLATE "C" %s
        LIMIT $4
    $sql$,
        p_sort_column,
        v_cursor_op,
        p_sort_column,
        p_sort_order,
        p_sort_order
    );

    RETURN QUERY EXECUTE v_query
    USING v_prefix, p_bucket_id, p_level, p_limit, p_start_after, p_sort_column_after;
END;
$_$;


--
-- Name: search_v2(text, text, integer, integer, text, text, text, text); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.search_v2(prefix text, bucket_name text, limits integer DEFAULT 100, levels integer DEFAULT 1, start_after text DEFAULT ''::text, sort_order text DEFAULT 'asc'::text, sort_column text DEFAULT 'name'::text, sort_column_after text DEFAULT ''::text) RETURNS TABLE(key text, name text, id uuid, updated_at timestamp with time zone, created_at timestamp with time zone, last_accessed_at timestamp with time zone, metadata jsonb)
    LANGUAGE plpgsql STABLE
    AS $$
DECLARE
    v_sort_col text;
    v_sort_ord text;
    v_limit int;
BEGIN
    -- Cap limit to maximum of 1500 records
    v_limit := LEAST(coalesce(limits, 100), 1500);

    -- Validate and normalize sort_order
    v_sort_ord := lower(coalesce(sort_order, 'asc'));
    IF v_sort_ord NOT IN ('asc', 'desc') THEN
        v_sort_ord := 'asc';
    END IF;

    -- Validate and normalize sort_column
    v_sort_col := lower(coalesce(sort_column, 'name'));
    IF v_sort_col NOT IN ('name', 'updated_at', 'created_at') THEN
        v_sort_col := 'name';
    END IF;

    -- Route to appropriate implementation
    IF v_sort_col = 'name' THEN
        -- Use list_objects_with_delimiter for name sorting (most efficient: O(k * log n))
        RETURN QUERY
        SELECT
            split_part(l.name, '/', levels) AS key,
            l.name AS name,
            l.id,
            l.updated_at,
            l.created_at,
            l.last_accessed_at,
            l.metadata
        FROM storage.list_objects_with_delimiter(
            bucket_name,
            coalesce(prefix, ''),
            '/',
            v_limit,
            start_after,
            '',
            v_sort_ord
        ) l;
    ELSE
        -- Use aggregation approach for timestamp sorting
        -- Not efficient for large datasets but supports correct pagination
        RETURN QUERY SELECT * FROM storage.search_by_timestamp(
            prefix, bucket_name, v_limit, levels, start_after,
            v_sort_ord, v_sort_col, sort_column_after
        );
    END IF;
END;
$$;


--
-- Name: update_updated_at_column(); Type: FUNCTION; Schema: storage; Owner: -
--

CREATE FUNCTION storage.update_updated_at_column() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW; 
END;
$$;


--
-- Name: audit_log_entries; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.audit_log_entries (
    instance_id uuid,
    id uuid NOT NULL,
    payload json,
    created_at timestamp with time zone,
    ip_address character varying(64) DEFAULT ''::character varying NOT NULL
);


--
-- Name: TABLE audit_log_entries; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.audit_log_entries IS 'Auth: Audit trail for user actions.';


--
-- Name: custom_oauth_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.custom_oauth_providers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    provider_type text NOT NULL,
    identifier text NOT NULL,
    name text NOT NULL,
    client_id text NOT NULL,
    client_secret text NOT NULL,
    acceptable_client_ids text[] DEFAULT '{}'::text[] NOT NULL,
    scopes text[] DEFAULT '{}'::text[] NOT NULL,
    pkce_enabled boolean DEFAULT true NOT NULL,
    attribute_mapping jsonb DEFAULT '{}'::jsonb NOT NULL,
    authorization_params jsonb DEFAULT '{}'::jsonb NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    email_optional boolean DEFAULT false NOT NULL,
    issuer text,
    discovery_url text,
    skip_nonce_check boolean DEFAULT false NOT NULL,
    cached_discovery jsonb,
    discovery_cached_at timestamp with time zone,
    authorization_url text,
    token_url text,
    userinfo_url text,
    jwks_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    custom_claims_allowlist text[] DEFAULT '{}'::text[] NOT NULL,
    CONSTRAINT custom_oauth_providers_authorization_url_https CHECK (((authorization_url IS NULL) OR (authorization_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_authorization_url_length CHECK (((authorization_url IS NULL) OR (char_length(authorization_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_client_id_length CHECK (((char_length(client_id) >= 1) AND (char_length(client_id) <= 512))),
    CONSTRAINT custom_oauth_providers_discovery_url_length CHECK (((discovery_url IS NULL) OR (char_length(discovery_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_identifier_format CHECK ((identifier ~ '^[a-z0-9][a-z0-9:-]{0,48}[a-z0-9]$'::text)),
    CONSTRAINT custom_oauth_providers_issuer_length CHECK (((issuer IS NULL) OR ((char_length(issuer) >= 1) AND (char_length(issuer) <= 2048)))),
    CONSTRAINT custom_oauth_providers_jwks_uri_https CHECK (((jwks_uri IS NULL) OR (jwks_uri ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_jwks_uri_length CHECK (((jwks_uri IS NULL) OR (char_length(jwks_uri) <= 2048))),
    CONSTRAINT custom_oauth_providers_name_length CHECK (((char_length(name) >= 1) AND (char_length(name) <= 100))),
    CONSTRAINT custom_oauth_providers_oauth2_requires_endpoints CHECK (((provider_type <> 'oauth2'::text) OR ((authorization_url IS NOT NULL) AND (token_url IS NOT NULL) AND (userinfo_url IS NOT NULL)))),
    CONSTRAINT custom_oauth_providers_oidc_discovery_url_https CHECK (((provider_type <> 'oidc'::text) OR (discovery_url IS NULL) OR (discovery_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_issuer_https CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NULL) OR (issuer ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_oidc_requires_issuer CHECK (((provider_type <> 'oidc'::text) OR (issuer IS NOT NULL))),
    CONSTRAINT custom_oauth_providers_provider_type_check CHECK ((provider_type = ANY (ARRAY['oauth2'::text, 'oidc'::text]))),
    CONSTRAINT custom_oauth_providers_token_url_https CHECK (((token_url IS NULL) OR (token_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_token_url_length CHECK (((token_url IS NULL) OR (char_length(token_url) <= 2048))),
    CONSTRAINT custom_oauth_providers_userinfo_url_https CHECK (((userinfo_url IS NULL) OR (userinfo_url ~~ 'https://%'::text))),
    CONSTRAINT custom_oauth_providers_userinfo_url_length CHECK (((userinfo_url IS NULL) OR (char_length(userinfo_url) <= 2048)))
);


--
-- Name: flow_state; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.flow_state (
    id uuid NOT NULL,
    user_id uuid,
    auth_code text,
    code_challenge_method auth.code_challenge_method,
    code_challenge text,
    provider_type text NOT NULL,
    provider_access_token text,
    provider_refresh_token text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    authentication_method text NOT NULL,
    auth_code_issued_at timestamp with time zone,
    invite_token text,
    referrer text,
    oauth_client_state_id uuid,
    linking_target_id uuid,
    email_optional boolean DEFAULT false NOT NULL
);


--
-- Name: TABLE flow_state; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.flow_state IS 'Stores metadata for all OAuth/SSO login flows';


--
-- Name: identities; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.identities (
    provider_id text NOT NULL,
    user_id uuid NOT NULL,
    identity_data jsonb NOT NULL,
    provider text NOT NULL,
    last_sign_in_at timestamp with time zone,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    email text GENERATED ALWAYS AS (lower((identity_data ->> 'email'::text))) STORED,
    id uuid DEFAULT gen_random_uuid() NOT NULL
);


--
-- Name: TABLE identities; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.identities IS 'Auth: Stores identities associated to a user.';


--
-- Name: COLUMN identities.email; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.identities.email IS 'Auth: Email is a generated column that references the optional email property in the identity_data';


--
-- Name: instances; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.instances (
    id uuid NOT NULL,
    uuid uuid,
    raw_base_config text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone
);


--
-- Name: TABLE instances; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.instances IS 'Auth: Manages users across multiple sites.';


--
-- Name: mfa_amr_claims; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_amr_claims (
    session_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    authentication_method text NOT NULL,
    id uuid NOT NULL
);


--
-- Name: TABLE mfa_amr_claims; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_amr_claims IS 'auth: stores authenticator method reference claims for multi factor authentication';


--
-- Name: mfa_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_challenges (
    id uuid NOT NULL,
    factor_id uuid NOT NULL,
    created_at timestamp with time zone NOT NULL,
    verified_at timestamp with time zone,
    ip_address inet NOT NULL,
    otp_code text,
    web_authn_session_data jsonb
);


--
-- Name: TABLE mfa_challenges; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_challenges IS 'auth: stores metadata about challenge requests made';


--
-- Name: mfa_factors; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.mfa_factors (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    friendly_name text,
    factor_type auth.factor_type NOT NULL,
    status auth.factor_status NOT NULL,
    created_at timestamp with time zone NOT NULL,
    updated_at timestamp with time zone NOT NULL,
    secret text,
    phone text,
    last_challenged_at timestamp with time zone,
    web_authn_credential jsonb,
    web_authn_aaguid uuid,
    last_webauthn_challenge_data jsonb
);


--
-- Name: TABLE mfa_factors; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.mfa_factors IS 'auth: stores metadata about factors';


--
-- Name: COLUMN mfa_factors.last_webauthn_challenge_data; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.mfa_factors.last_webauthn_challenge_data IS 'Stores the latest WebAuthn challenge data including attestation/assertion for customer verification';


--
-- Name: oauth_authorizations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_authorizations (
    id uuid NOT NULL,
    authorization_id text NOT NULL,
    client_id uuid NOT NULL,
    user_id uuid,
    redirect_uri text NOT NULL,
    scope text NOT NULL,
    state text,
    resource text,
    code_challenge text,
    code_challenge_method auth.code_challenge_method,
    response_type auth.oauth_response_type DEFAULT 'code'::auth.oauth_response_type NOT NULL,
    status auth.oauth_authorization_status DEFAULT 'pending'::auth.oauth_authorization_status NOT NULL,
    authorization_code text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone DEFAULT (now() + '00:03:00'::interval) NOT NULL,
    approved_at timestamp with time zone,
    nonce text,
    CONSTRAINT oauth_authorizations_authorization_code_length CHECK ((char_length(authorization_code) <= 255)),
    CONSTRAINT oauth_authorizations_code_challenge_length CHECK ((char_length(code_challenge) <= 128)),
    CONSTRAINT oauth_authorizations_expires_at_future CHECK ((expires_at > created_at)),
    CONSTRAINT oauth_authorizations_nonce_length CHECK ((char_length(nonce) <= 255)),
    CONSTRAINT oauth_authorizations_redirect_uri_length CHECK ((char_length(redirect_uri) <= 2048)),
    CONSTRAINT oauth_authorizations_resource_length CHECK ((char_length(resource) <= 2048)),
    CONSTRAINT oauth_authorizations_scope_length CHECK ((char_length(scope) <= 4096)),
    CONSTRAINT oauth_authorizations_state_length CHECK ((char_length(state) <= 4096))
);


--
-- Name: oauth_client_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_client_states (
    id uuid NOT NULL,
    provider_type text NOT NULL,
    code_verifier text,
    created_at timestamp with time zone NOT NULL
);


--
-- Name: TABLE oauth_client_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.oauth_client_states IS 'Stores OAuth states for third-party provider authentication flows where Supabase acts as the OAuth client.';


--
-- Name: oauth_clients; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_clients (
    id uuid NOT NULL,
    client_secret_hash text,
    registration_type auth.oauth_registration_type NOT NULL,
    redirect_uris text NOT NULL,
    grant_types text NOT NULL,
    client_name text,
    client_uri text,
    logo_uri text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    client_type auth.oauth_client_type DEFAULT 'confidential'::auth.oauth_client_type NOT NULL,
    token_endpoint_auth_method text NOT NULL,
    CONSTRAINT oauth_clients_client_name_length CHECK ((char_length(client_name) <= 1024)),
    CONSTRAINT oauth_clients_client_uri_length CHECK ((char_length(client_uri) <= 2048)),
    CONSTRAINT oauth_clients_logo_uri_length CHECK ((char_length(logo_uri) <= 2048)),
    CONSTRAINT oauth_clients_token_endpoint_auth_method_check CHECK ((token_endpoint_auth_method = ANY (ARRAY['client_secret_basic'::text, 'client_secret_post'::text, 'none'::text])))
);


--
-- Name: oauth_consents; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.oauth_consents (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    client_id uuid NOT NULL,
    scopes text NOT NULL,
    granted_at timestamp with time zone DEFAULT now() NOT NULL,
    revoked_at timestamp with time zone,
    CONSTRAINT oauth_consents_revoked_after_granted CHECK (((revoked_at IS NULL) OR (revoked_at >= granted_at))),
    CONSTRAINT oauth_consents_scopes_length CHECK ((char_length(scopes) <= 2048)),
    CONSTRAINT oauth_consents_scopes_not_empty CHECK ((char_length(TRIM(BOTH FROM scopes)) > 0))
);


--
-- Name: one_time_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.one_time_tokens (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    token_type auth.one_time_token_type NOT NULL,
    token_hash text NOT NULL,
    relates_to text NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT one_time_tokens_token_hash_check CHECK ((char_length(token_hash) > 0))
);


--
-- Name: refresh_tokens; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.refresh_tokens (
    instance_id uuid,
    id bigint NOT NULL,
    token character varying(255),
    user_id character varying(255),
    revoked boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    parent character varying(255),
    session_id uuid
);


--
-- Name: TABLE refresh_tokens; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.refresh_tokens IS 'Auth: Store of tokens used to refresh JWT tokens once they expire.';


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE; Schema: auth; Owner: -
--

CREATE SEQUENCE auth.refresh_tokens_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: refresh_tokens_id_seq; Type: SEQUENCE OWNED BY; Schema: auth; Owner: -
--

ALTER SEQUENCE auth.refresh_tokens_id_seq OWNED BY auth.refresh_tokens.id;


--
-- Name: saml_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_providers (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    entity_id text NOT NULL,
    metadata_xml text NOT NULL,
    metadata_url text,
    attribute_mapping jsonb,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    name_id_format text,
    CONSTRAINT "entity_id not empty" CHECK ((char_length(entity_id) > 0)),
    CONSTRAINT "metadata_url not empty" CHECK (((metadata_url = NULL::text) OR (char_length(metadata_url) > 0))),
    CONSTRAINT "metadata_xml not empty" CHECK ((char_length(metadata_xml) > 0))
);


--
-- Name: TABLE saml_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_providers IS 'Auth: Manages SAML Identity Provider connections.';


--
-- Name: saml_relay_states; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.saml_relay_states (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    request_id text NOT NULL,
    for_email text,
    redirect_to text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    flow_state_id uuid,
    CONSTRAINT "request_id not empty" CHECK ((char_length(request_id) > 0))
);


--
-- Name: TABLE saml_relay_states; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.saml_relay_states IS 'Auth: Contains SAML Relay State information for each Service Provider initiated login.';


--
-- Name: schema_migrations; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.schema_migrations (
    version character varying(255) NOT NULL
);


--
-- Name: TABLE schema_migrations; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.schema_migrations IS 'Auth: Manages updates to the auth system.';


--
-- Name: sessions; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sessions (
    id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    factor_id uuid,
    aal auth.aal_level,
    not_after timestamp with time zone,
    refreshed_at timestamp without time zone,
    user_agent text,
    ip inet,
    tag text,
    oauth_client_id uuid,
    refresh_token_hmac_key text,
    refresh_token_counter bigint,
    scopes text,
    CONSTRAINT sessions_scopes_length CHECK ((char_length(scopes) <= 4096))
);


--
-- Name: TABLE sessions; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sessions IS 'Auth: Stores session data associated to a user.';


--
-- Name: COLUMN sessions.not_after; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.not_after IS 'Auth: Not after is a nullable column that contains a timestamp after which the session should be regarded as expired.';


--
-- Name: COLUMN sessions.refresh_token_hmac_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_hmac_key IS 'Holds a HMAC-SHA256 key used to sign refresh tokens for this session.';


--
-- Name: COLUMN sessions.refresh_token_counter; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sessions.refresh_token_counter IS 'Holds the ID (counter) of the last issued refresh token.';


--
-- Name: sso_domains; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_domains (
    id uuid NOT NULL,
    sso_provider_id uuid NOT NULL,
    domain text NOT NULL,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    CONSTRAINT "domain not empty" CHECK ((char_length(domain) > 0))
);


--
-- Name: TABLE sso_domains; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_domains IS 'Auth: Manages SSO email address domain mapping to an SSO Identity Provider.';


--
-- Name: sso_providers; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.sso_providers (
    id uuid NOT NULL,
    resource_id text,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    disabled boolean,
    CONSTRAINT "resource_id not empty" CHECK (((resource_id = NULL::text) OR (char_length(resource_id) > 0)))
);


--
-- Name: TABLE sso_providers; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.sso_providers IS 'Auth: Manages SSO identity provider information; see saml_providers for SAML.';


--
-- Name: COLUMN sso_providers.resource_id; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.sso_providers.resource_id IS 'Auth: Uniquely identifies a SSO provider according to a user-chosen resource ID (case insensitive), useful in infrastructure as code.';


--
-- Name: users; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.users (
    instance_id uuid,
    id uuid NOT NULL,
    aud character varying(255),
    role character varying(255),
    email character varying(255),
    encrypted_password character varying(255),
    email_confirmed_at timestamp with time zone,
    invited_at timestamp with time zone,
    confirmation_token character varying(255),
    confirmation_sent_at timestamp with time zone,
    recovery_token character varying(255),
    recovery_sent_at timestamp with time zone,
    email_change_token_new character varying(255),
    email_change character varying(255),
    email_change_sent_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    raw_app_meta_data jsonb,
    raw_user_meta_data jsonb,
    is_super_admin boolean,
    created_at timestamp with time zone,
    updated_at timestamp with time zone,
    phone text DEFAULT NULL::character varying,
    phone_confirmed_at timestamp with time zone,
    phone_change text DEFAULT ''::character varying,
    phone_change_token character varying(255) DEFAULT ''::character varying,
    phone_change_sent_at timestamp with time zone,
    confirmed_at timestamp with time zone GENERATED ALWAYS AS (LEAST(email_confirmed_at, phone_confirmed_at)) STORED,
    email_change_token_current character varying(255) DEFAULT ''::character varying,
    email_change_confirm_status smallint DEFAULT 0,
    banned_until timestamp with time zone,
    reauthentication_token character varying(255) DEFAULT ''::character varying,
    reauthentication_sent_at timestamp with time zone,
    is_sso_user boolean DEFAULT false NOT NULL,
    deleted_at timestamp with time zone,
    is_anonymous boolean DEFAULT false NOT NULL,
    CONSTRAINT users_email_change_confirm_status_check CHECK (((email_change_confirm_status >= 0) AND (email_change_confirm_status <= 2)))
);


--
-- Name: TABLE users; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON TABLE auth.users IS 'Auth: Stores user login data within a secure schema.';


--
-- Name: COLUMN users.is_sso_user; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON COLUMN auth.users.is_sso_user IS 'Auth: Set this column to true when the account comes from SSO. These accounts can have duplicate emails.';


--
-- Name: webauthn_challenges; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_challenges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid,
    challenge_type text NOT NULL,
    session_data jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT webauthn_challenges_challenge_type_check CHECK ((challenge_type = ANY (ARRAY['signup'::text, 'registration'::text, 'authentication'::text])))
);


--
-- Name: webauthn_credentials; Type: TABLE; Schema: auth; Owner: -
--

CREATE TABLE auth.webauthn_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    credential_id bytea NOT NULL,
    public_key bytea NOT NULL,
    attestation_type text DEFAULT ''::text NOT NULL,
    aaguid uuid,
    sign_count bigint DEFAULT 0 NOT NULL,
    transports jsonb DEFAULT '[]'::jsonb NOT NULL,
    backup_eligible boolean DEFAULT false NOT NULL,
    backed_up boolean DEFAULT false NOT NULL,
    friendly_name text DEFAULT ''::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    last_used_at timestamp with time zone
);


--
-- Name: adapter_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.adapter_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    adapter_name text NOT NULL,
    api_cost_cents integer DEFAULT 0 NOT NULL,
    records_returned integer DEFAULT 0 NOT NULL,
    cache_hit boolean DEFAULT false NOT NULL,
    called_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_configurations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_configurations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    agent_id text NOT NULL,
    enabled boolean DEFAULT false,
    config jsonb DEFAULT '{}'::jsonb,
    last_run_at timestamp with time zone,
    run_count integer DEFAULT 0,
    total_tokens_consumed integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: agent_decisions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_decisions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    agent_id text NOT NULL,
    decision_type text NOT NULL,
    entity_type text,
    entity_id uuid,
    reasoning text NOT NULL,
    confidence_score integer,
    action_taken text NOT NULL,
    required_human_review boolean DEFAULT false,
    human_reviewed_at timestamp with time zone,
    human_verdict text,
    created_at timestamp with time zone DEFAULT now(),
    agent_run_id uuid,
    action_payload jsonb DEFAULT '{}'::jsonb,
    human_reviewer_id uuid
);


--
-- Name: agent_performance_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_performance_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    agent_id text NOT NULL,
    metric_date date NOT NULL,
    runs_total integer DEFAULT 0,
    runs_successful integer DEFAULT 0,
    avg_confidence_score numeric,
    avg_items_processed numeric,
    decisions_requiring_review integer,
    decisions_auto_approved integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: agent_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    agent_id text NOT NULL,
    priority integer DEFAULT 5,
    status text DEFAULT 'queued'::text,
    trigger_source text NOT NULL,
    input_payload jsonb,
    output_payload jsonb,
    error_message text,
    queued_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3
);


--
-- Name: agent_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_registry (
    agent_id text NOT NULL,
    name text NOT NULL,
    description text NOT NULL,
    version text DEFAULT '1.0'::text,
    plan_requirement text DEFAULT 'starter'::text NOT NULL,
    trigger_type text DEFAULT 'manual'::text NOT NULL,
    schedule_cron text,
    avg_runtime_seconds integer,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    avg_tokens_per_run integer
);


--
-- Name: agent_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.agent_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    agent_type public.agent_type NOT NULL,
    status public.agent_run_status DEFAULT 'pending'::public.agent_run_status,
    input_params jsonb,
    output_summary text,
    items_found integer DEFAULT 0,
    items_processed integer DEFAULT 0,
    error_message text,
    tokens_used integer,
    duration_ms integer,
    triggered_by uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    trigger_source text DEFAULT 'manual'::text,
    next_action text,
    confidence_score integer,
    items_queued integer DEFAULT 0,
    output_payload jsonb DEFAULT '{}'::jsonb
);


--
-- Name: ai_usage_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    model text NOT NULL,
    endpoint text NOT NULL,
    input_tokens integer DEFAULT 0,
    output_tokens integer DEFAULT 0,
    total_tokens integer DEFAULT 0,
    estimated_cost_cents integer DEFAULT 0,
    duration_ms integer,
    agent_type text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    type public.alert_type NOT NULL,
    severity public.alert_severity DEFAULT 'info'::public.alert_severity NOT NULL,
    message text NOT NULL,
    link text,
    is_read boolean DEFAULT false NOT NULL,
    read_at timestamp with time zone,
    is_dismissed boolean DEFAULT false NOT NULL,
    dismissed_at timestamp with time zone,
    snoozed_until timestamp with time zone,
    opportunity_id uuid,
    application_id uuid,
    deadline_id uuid,
    dedup_key text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: application_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.application_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    document_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: applications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.applications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    stage public.pipeline_stage DEFAULT 'discovered'::public.pipeline_stage NOT NULL,
    assigned_user_id uuid,
    requested_amount numeric(12,2),
    submitted_at timestamp with time zone,
    awarded_amount numeric(12,2),
    draft_content text,
    draft_template_type public.draft_template_type,
    draft_confidence_score integer,
    draft_knowledge_sources jsonb,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    auto_generated boolean DEFAULT false,
    pending_review boolean DEFAULT false,
    draft_source text DEFAULT 'manual'::text,
    budget_data jsonb,
    compliance_check_result jsonb,
    fit_analysis jsonb,
    twin_powered boolean DEFAULT false,
    twin_completeness integer,
    platform_patterns_applied integer DEFAULT 0,
    knowledge_patterns_applied jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid,
    action public.audit_action NOT NULL,
    entity_type text,
    entity_id uuid,
    details jsonb DEFAULT '{}'::jsonb,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: auto_queue_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.auto_queue_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    enabled boolean DEFAULT false NOT NULL,
    max_per_batch integer DEFAULT 50 NOT NULL,
    schedule text DEFAULT 'nightly'::text NOT NULL,
    categories text[],
    geographic_scope text[],
    min_company_size text,
    exclusion_list uuid[],
    dedup_window_days integer DEFAULT 30 NOT NULL,
    last_run_at timestamp with time zone,
    last_run_queued integer DEFAULT 0,
    last_run_skipped integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: autoapply_confirmation_ambiguous_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autoapply_confirmation_ambiguous_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    gmail_message_id text NOT NULL,
    candidate_submission_ids uuid[] NOT NULL,
    sender text,
    subject text,
    received_at timestamp with time zone,
    status text DEFAULT 'needs_manual_match'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT autoapply_confirmation_ambiguous_matches_status_check CHECK ((status = ANY (ARRAY['needs_manual_match'::text, 'resolved'::text, 'dismissed'::text])))
);


--
-- Name: autoapply_confirmation_processed_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autoapply_confirmation_processed_messages (
    gmail_message_id text NOT NULL,
    processed_at timestamp with time zone DEFAULT now() NOT NULL,
    match_status text NOT NULL,
    matched_submission_id uuid,
    CONSTRAINT autoapply_confirmation_processed_messages_match_status_check CHECK ((match_status = ANY (ARRAY['matched'::text, 'ambiguous'::text, 'no_match'::text])))
);


--
-- Name: autoapply_follow_ups; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autoapply_follow_ups (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    submission_id uuid NOT NULL,
    funder_id uuid NOT NULL,
    sequence_number integer NOT NULL,
    scheduled_at timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    status text DEFAULT 'pending'::text NOT NULL,
    template_type text NOT NULL,
    content text,
    response_received boolean DEFAULT false NOT NULL,
    cancel_reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT autoapply_follow_ups_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'sent'::text, 'cancelled'::text, 'skipped'::text, 'failed'::text]))),
    CONSTRAINT autoapply_follow_ups_template_type_check CHECK ((template_type = ANY (ARRAY['initial_followup'::text, 'second_followup'::text, 'final_followup'::text])))
);


--
-- Name: autoapply_review_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autoapply_review_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid,
    organization_id uuid NOT NULL,
    funder_id uuid NOT NULL,
    reason text NOT NULL,
    failure_count integer DEFAULT 0 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    assigned_to uuid,
    resolved_at timestamp with time zone,
    resolution_notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: autoapply_screenshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autoapply_screenshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid,
    stage text NOT NULL,
    storage_path text NOT NULL,
    captured_at timestamp with time zone DEFAULT now(),
    metadata jsonb DEFAULT '{}'::jsonb
);


--
-- Name: autoapply_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autoapply_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid,
    form_template_id uuid,
    status text DEFAULT 'queued'::text NOT NULL,
    request_description text,
    request_type text,
    request_amount numeric(12,2),
    pre_submit_screenshot_url text,
    confirmation_screenshot_url text,
    confirmation_number text,
    error_message text,
    error_screenshot_url text,
    retry_count integer DEFAULT 0 NOT NULL,
    next_retry_at timestamp with time zone,
    submitted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_profile_id uuid,
    submission_channel text DEFAULT 'web_form'::text,
    personalized_pitch text,
    optimized_amount numeric(12,2),
    timing_score numeric(3,2),
    confirmation_data jsonb,
    documents_attached text[],
    confirmation_email_received boolean DEFAULT false NOT NULL,
    confirmation_received_at timestamp with time zone,
    CONSTRAINT autoapply_submissions_status_check CHECK ((status = ANY (ARRAY['queued'::text, 'in_progress'::text, 'submitted'::text, 'failed'::text, 'captcha_blocked'::text, 'account_required'::text, 'site_error'::text, 'already_submitted'::text])))
);


--
-- Name: automation_notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_notifications (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    session_id uuid,
    event_type text NOT NULL,
    message text NOT NULL,
    is_read boolean DEFAULT false,
    sent_via text DEFAULT 'in_app'::text,
    created_at timestamp with time zone DEFAULT now(),
    title text,
    related_entity_type text,
    related_entity_id uuid
);


--
-- Name: automation_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid,
    priority integer DEFAULT 3,
    status text DEFAULT 'queued'::text,
    automation_level text DEFAULT 'supervised'::text,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 3,
    error_log jsonb,
    created_at timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone
);


--
-- Name: automation_screenshots; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_screenshots (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    step_id uuid,
    storage_path text NOT NULL,
    description text,
    page_url text,
    captured_at timestamp with time zone DEFAULT now()
);


--
-- Name: automation_sessions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_sessions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid,
    opportunity_id uuid,
    funder_id uuid,
    status public.automation_status DEFAULT 'pending'::public.automation_status NOT NULL,
    target_url text,
    mapped_fields jsonb DEFAULT '[]'::jsonb,
    unmapped_fields jsonb DEFAULT '[]'::jsonb,
    confirmation_number text,
    error_message text,
    notes text,
    started_by uuid,
    approved_by uuid,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    session_type public.session_type,
    steps jsonb DEFAULT '[]'::jsonb NOT NULL,
    screenshots text[] DEFAULT '{}'::text[] NOT NULL,
    approval_required_at timestamp with time zone
);


--
-- Name: automation_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.automation_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    session_id uuid NOT NULL,
    step_number integer NOT NULL,
    action text NOT NULL,
    description text,
    status text DEFAULT 'pending'::text,
    input_data jsonb,
    output_data jsonb,
    error_message text,
    duration_ms integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: autonomous_triggers; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.autonomous_triggers (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    agent_id text NOT NULL,
    trigger_type text NOT NULL,
    is_enabled boolean DEFAULT true,
    fire_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: board_meeting_packets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_meeting_packets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    meeting_id uuid,
    packet_content jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    viewed_by text[]
);


--
-- Name: board_meetings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_meetings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    meeting_date date NOT NULL,
    meeting_type text DEFAULT 'regular'::text NOT NULL,
    agenda text,
    status text DEFAULT 'scheduled'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: board_members; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.board_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    title text,
    bio text,
    email text,
    phone text,
    start_date date,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: calendar_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider text DEFAULT 'google'::text NOT NULL,
    calendar_id text DEFAULT 'primary'::text NOT NULL,
    calendar_name text,
    access_token_encrypted text,
    refresh_token_encrypted text,
    token_expires_at timestamp with time zone,
    sync_status public.calendar_sync_status DEFAULT 'disconnected'::public.calendar_sync_status,
    last_sync_at timestamp with time zone,
    sync_token text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: calendar_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.calendar_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    connection_id uuid NOT NULL,
    google_event_id text,
    title text NOT NULL,
    description text,
    start_time timestamp with time zone NOT NULL,
    end_time timestamp with time zone NOT NULL,
    all_day boolean DEFAULT false,
    location text,
    event_type text DEFAULT 'deadline'::text,
    linked_deadline_id uuid,
    linked_opportunity_id uuid,
    linked_application_id uuid,
    is_synced boolean DEFAULT false,
    recurrence_rule text,
    reminder_minutes integer[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: campaign_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_step_id uuid NOT NULL,
    outreach_contact_id uuid NOT NULL,
    status public.campaign_step_status DEFAULT 'pending'::public.campaign_step_status,
    sent_at timestamp with time zone,
    opened_at timestamp with time zone,
    replied_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE campaign_sends; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.campaign_sends IS 'DEPRECATED 2026-08-13: superseded by email_sequence_enrollments. Do not write to this table going forward. See OUTREACH_CONSOLIDATION_AUDIT.md.';


--
-- Name: campaign_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.campaign_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    step_number integer NOT NULL,
    subject_template text NOT NULL,
    body_template text NOT NULL,
    delay_days integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE campaign_steps; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.campaign_steps IS 'DEPRECATED 2026-08-13: superseded by email_sequence_steps. Do not write to this table going forward. See OUTREACH_CONSOLIDATION_AUDIT.md.';


--
-- Name: community_foundation_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_foundation_registry (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    website text NOT NULL,
    grants_page text,
    state text,
    estimated_assets numeric(14,2),
    programs_found jsonb DEFAULT '[]'::jsonb,
    last_checked_at timestamp with time zone,
    last_snapshot text,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: community_need_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_need_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    signal_source text NOT NULL,
    signal_category text NOT NULL,
    signal_description text NOT NULL,
    geographic_area text,
    trend_direction text,
    severity text,
    predicted_demand_increase integer,
    recommended_program_expansion text,
    data_date date,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: competitor_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.competitor_tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    competitor_name text NOT NULL,
    competitor_ein text,
    funder_id uuid,
    grant_amount numeric(12,2),
    grant_purpose text,
    fiscal_year integer,
    source text,
    created_at timestamp with time zone DEFAULT now(),
    opportunity_id uuid,
    estimated_applicants integer,
    competition_level text,
    observed_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT competitor_tracking_competition_level_check CHECK ((competition_level = ANY (ARRAY['low'::text, 'medium'::text, 'high'::text, 'very_high'::text])))
);


--
-- Name: compliance_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.compliance_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid,
    event_type text NOT NULL,
    title text NOT NULL,
    due_date date NOT NULL,
    recurrence text,
    completed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT compliance_events_event_type_check CHECK ((event_type = ANY (ARRAY['report'::text, 'audit'::text, 'renewal'::text, 'meeting'::text])))
);


--
-- Name: contact_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contact_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    contact_id uuid NOT NULL,
    task_type text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    subject text,
    content text NOT NULL,
    asset_path text,
    due_at timestamp with time zone,
    completed_at timestamp with time zone,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT contact_tasks_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'cancelled'::text]))),
    CONSTRAINT contact_tasks_task_type_check CHECK ((task_type = ANY (ARRAY['linkedin_message'::text, 'call'::text, 'mail_letter'::text])))
);


--
-- Name: contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid NOT NULL,
    name text NOT NULL,
    title text,
    email text,
    phone text,
    preferred_contact_method text,
    relationship public.contact_relationship DEFAULT 'cold'::public.contact_relationship,
    last_contacted_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: corporate_giving_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_giving_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    company_name text NOT NULL,
    website text NOT NULL,
    giving_page text,
    program_names text[],
    geographic_focus text[],
    funding_areas text[],
    estimated_annual_giving numeric(14,2),
    application_url text,
    last_checked_at timestamp with time zone,
    last_snapshot text,
    change_history jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: corporate_intent_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_intent_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    company_name text NOT NULL,
    signal_type text NOT NULL,
    signal_summary text NOT NULL,
    signal_url text,
    signal_date date,
    intent_score integer,
    geographic_relevance integer,
    mission_alignment integer,
    recommended_action text,
    recommended_deadline date,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: corporate_monitoring_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_monitoring_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    event_type text NOT NULL,
    description text,
    change_detected jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: corporate_prospects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_prospects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    legal_name text NOT NULL,
    dba_name text,
    ein text,
    duns_number text,
    website text,
    phone text,
    email text,
    address_street text,
    address_city text,
    address_state text,
    address_zip text,
    address_lat numeric,
    address_lng numeric,
    naics_code text,
    naics_description text,
    sic_code text,
    industry_category text,
    employee_count_estimate text,
    revenue_estimate text,
    location_count integer,
    geographic_footprint text[],
    ownership_type text,
    is_family_owned boolean,
    is_veteran_owned boolean,
    is_minority_owned boolean,
    is_woman_owned boolean,
    parent_company_id uuid,
    source_adapters text[],
    first_seen_at timestamp with time zone DEFAULT now(),
    last_verified_at timestamp with time zone,
    enrichment jsonb DEFAULT '{}'::jsonb,
    enrichment_version integer DEFAULT 0,
    enrichment_started_at timestamp with time zone,
    enrichment_completed_at timestamp with time zone,
    scores jsonb DEFAULT '{}'::jsonb,
    scores_computed_at timestamp with time zone,
    giving_dna jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: corporate_relationships; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.corporate_relationships (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    source_type text NOT NULL,
    source_entity_name text NOT NULL,
    target_entity_name text NOT NULL,
    relationship_description text,
    warm_introduction_path text,
    introduction_strength text,
    discovered_at timestamp with time zone DEFAULT now(),
    verified boolean DEFAULT false
);


--
-- Name: cross_client_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cross_client_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    funder_domain text NOT NULL,
    submitted_at timestamp with time zone DEFAULT now() NOT NULL,
    org_hash text NOT NULL
);


--
-- Name: custom_api_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_api_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    base_url text NOT NULL,
    auth_type text DEFAULT 'none'::text,
    auth_config jsonb DEFAULT '{}'::jsonb,
    field_mapping jsonb DEFAULT '{}'::jsonb,
    poll_schedule text DEFAULT 'daily'::text,
    is_active boolean DEFAULT true,
    last_polled_at timestamp with time zone,
    last_success_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    error_count integer DEFAULT 0
);


--
-- Name: custom_connector_allowlist; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.custom_connector_allowlist (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    domain text NOT NULL,
    label text,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: dd_prospect_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dd_prospect_requests (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    prospect_id uuid NOT NULL,
    request_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: dd_robots_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.dd_robots_cache (
    domain text NOT NULL,
    robots_txt text DEFAULT ''::text NOT NULL,
    status_code integer,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: deadlines; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.deadlines (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid,
    opportunity_id uuid,
    deadline_type public.deadline_type NOT NULL,
    due_date date NOT NULL,
    title text NOT NULL,
    description text,
    is_completed boolean DEFAULT false,
    completed_at timestamp with time zone,
    reminder_30d_sent boolean DEFAULT false,
    reminder_14d_sent boolean DEFAULT false,
    reminder_7d_sent boolean DEFAULT false,
    reminder_3d_sent boolean DEFAULT false,
    reminder_1d_sent boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    google_calendar_event_id text
);


--
-- Name: disaster_declarations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disaster_declarations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fema_disaster_number text,
    disaster_type text,
    incident_type text,
    affected_states text[],
    declaration_date date,
    incident_begin_date date,
    response_deployed boolean DEFAULT false NOT NULL,
    response_deployed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: disaster_emergency_funds; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.disaster_emergency_funds (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    funder text NOT NULL,
    program_type text,
    typical_amount text,
    application_url text,
    notes text,
    disaster_types text[],
    active boolean DEFAULT true NOT NULL
);


--
-- Name: discovery_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discovery_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid,
    external_title text,
    external_source text,
    external_url text,
    discovery_run_id uuid,
    match_score numeric,
    match_reasons text[],
    status text DEFAULT 'pending'::text,
    actioned_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: discovery_runs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.discovery_runs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    run_date date NOT NULL,
    opportunities_found integer DEFAULT 0,
    opportunities_matched integer DEFAULT 0,
    sources_checked text[],
    runtime_seconds integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    file_name text NOT NULL,
    storage_path text NOT NULL,
    file_size bigint,
    mime_type text,
    category public.document_category NOT NULL,
    description text,
    expiration_date date,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: donor_discovery_connectors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donor_discovery_connectors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    provider public.donor_discovery_connector_provider NOT NULL,
    encrypted_api_key text NOT NULL,
    status public.donor_discovery_connector_status DEFAULT 'pending'::public.donor_discovery_connector_status NOT NULL,
    activated_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: donor_discovery_geocache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donor_discovery_geocache (
    address_hash text NOT NULL,
    lat numeric NOT NULL,
    lng numeric NOT NULL,
    formatted_address text NOT NULL,
    state text,
    county text,
    zip text,
    cached_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: donor_discovery_prospects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donor_discovery_prospects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    directory_id uuid NOT NULL,
    request_id uuid NOT NULL,
    score integer,
    score_rationale text,
    pipeline_stage public.donor_discovery_pipeline_stage DEFAULT 'new'::public.donor_discovery_pipeline_stage NOT NULL,
    notes text,
    assigned_to uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT donor_discovery_prospects_score_check CHECK (((score >= 0) AND (score <= 100)))
);


--
-- Name: donor_discovery_taxonomy; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donor_discovery_taxonomy (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    kind public.donor_discovery_taxonomy_kind NOT NULL,
    code text NOT NULL,
    label text NOT NULL,
    parent_id uuid,
    default_sources jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: donor_discovery_taxonomy_aliases; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donor_discovery_taxonomy_aliases (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    taxonomy_id uuid NOT NULL,
    alias text NOT NULL,
    alias_type text DEFAULT 'trade_name'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT donor_discovery_taxonomy_aliases_alias_type_check CHECK ((alias_type = ANY (ARRAY['trade_name'::text, 'keyword'::text, 'common_name'::text, 'material'::text])))
);


--
-- Name: donor_discovery_tos_registry; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.donor_discovery_tos_registry (
    domain text NOT NULL,
    scrape_allowed boolean DEFAULT true NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: draft_automation_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.draft_automation_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    is_enabled boolean DEFAULT false,
    min_eligibility_score integer DEFAULT 70,
    auto_generate_on_discovery boolean DEFAULT true,
    auto_generate_on_deadline_days integer DEFAULT 14,
    daily_draft_limit integer DEFAULT 5,
    preferred_template_rules jsonb DEFAULT '{}'::jsonb,
    excluded_categories text[] DEFAULT '{}'::text[],
    excluded_funder_ids uuid[] DEFAULT '{}'::uuid[],
    require_approval_before_submit boolean DEFAULT true,
    auto_submit_above_confidence integer,
    notification_on_generation boolean DEFAULT true,
    notification_on_deadline boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: draft_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.draft_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    application_id uuid,
    status public.draft_queue_status DEFAULT 'pending'::public.draft_queue_status,
    trigger_reason public.draft_trigger DEFAULT 'auto_scheduled'::public.draft_trigger NOT NULL,
    template_type text DEFAULT 'grant_narrative'::text NOT NULL,
    priority integer DEFAULT 3,
    draft_id uuid,
    confidence_score integer,
    gap_count integer DEFAULT 0,
    word_count integer DEFAULT 0,
    auto_generated_at timestamp with time zone,
    reviewed_by uuid,
    reviewed_at timestamp with time zone,
    review_notes text,
    approved_at timestamp with time zone,
    rejected_reason text,
    submitted_to_autoapply_at timestamp with time zone,
    deadline_date timestamp with time zone,
    scheduled_for date,
    error_message text,
    retry_count integer DEFAULT 0,
    max_retries integer DEFAULT 2,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT draft_queue_priority_check CHECK (((priority >= 1) AND (priority <= 5)))
);


--
-- Name: draft_versions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.draft_versions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    application_id uuid,
    template_type public.draft_template_type NOT NULL,
    content text NOT NULL,
    confidence_score integer,
    knowledge_sources jsonb,
    version_number integer NOT NULL,
    humanization_status public.humanization_status DEFAULT 'not_humanized'::public.humanization_status NOT NULL,
    source text DEFAULT 'generated'::text NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_activity; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_activity (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid,
    opportunity_id uuid,
    application_id uuid,
    email_type text NOT NULL,
    subject text,
    sender text,
    received_at timestamp with time zone,
    summary text,
    action_required boolean DEFAULT false,
    action_description text,
    urgency text DEFAULT 'low'::text,
    thread_id text,
    processed_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_campaign_sequences; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaign_sequences (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    trigger_type text DEFAULT 'manual'::text NOT NULL,
    trigger_config jsonb DEFAULT '{}'::jsonb,
    status public.campaign_status DEFAULT 'draft'::public.campaign_status,
    total_enrolled integer DEFAULT 0,
    total_completed integer DEFAULT 0,
    total_replied integer DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    status public.campaign_status DEFAULT 'draft'::public.campaign_status,
    total_steps integer DEFAULT 0,
    total_contacts integer DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: TABLE email_campaigns; Type: COMMENT; Schema: public; Owner: -
--

COMMENT ON TABLE public.email_campaigns IS 'DEPRECATED 2026-08-13: superseded by email_campaign_sequences. Do not write to this table going forward. See OUTREACH_CONSOLIDATION_AUDIT.md.';


--
-- Name: email_connections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_connections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    provider text DEFAULT 'gmail'::text NOT NULL,
    email_address text NOT NULL,
    access_token_encrypted text,
    refresh_token_encrypted text,
    token_expires_at timestamp with time zone,
    sync_status public.email_sync_status DEFAULT 'disconnected'::public.email_sync_status,
    last_sync_at timestamp with time zone,
    sync_cursor text,
    scopes text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_sequence_enrollments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_sequence_enrollments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    sequence_id uuid NOT NULL,
    contact_id uuid,
    funder_id uuid,
    email_address text NOT NULL,
    current_step integer DEFAULT 0,
    status text DEFAULT 'active'::text,
    enrolled_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone,
    paused_at timestamp with time zone,
    last_sent_at timestamp with time zone,
    next_send_at timestamp with time zone,
    reply_detected boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    variables jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: email_sequence_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_sequence_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    sequence_id uuid NOT NULL,
    step_number integer NOT NULL,
    template_id uuid,
    subject_override text,
    body_override text,
    delay_days integer DEFAULT 0 NOT NULL,
    delay_hours integer DEFAULT 0,
    condition_type text DEFAULT 'always'::text,
    condition_config jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    subject_template text NOT NULL,
    body_template text NOT NULL,
    template_type text DEFAULT 'general'::text NOT NULL,
    variables text[] DEFAULT '{}'::text[],
    is_active boolean DEFAULT true,
    use_count integer DEFAULT 0,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: email_thread_links; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.email_thread_links (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    funder_id uuid,
    contact_id uuid,
    outreach_contact_id uuid,
    match_type text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: enrichment_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrichment_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid,
    job_type text DEFAULT 'foundation_enrichment'::text NOT NULL,
    status public.enrichment_job_status DEFAULT 'queued'::public.enrichment_job_status,
    target_table text NOT NULL,
    total_records integer DEFAULT 0,
    processed integer DEFAULT 0,
    enriched integer DEFAULT 0,
    failed integer DEFAULT 0,
    skipped integer DEFAULT 0,
    sources_used public.enrichment_source[] DEFAULT '{}'::public.enrichment_source[],
    config jsonb DEFAULT '{}'::jsonb,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    paused_at timestamp with time zone,
    last_processed_id text,
    error_log jsonb DEFAULT '[]'::jsonb,
    results_summary jsonb DEFAULT '{}'::jsonb,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: enrichment_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enrichment_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid NOT NULL,
    entity_id text NOT NULL,
    entity_name text,
    entity_ein text,
    source public.enrichment_source NOT NULL,
    found_website text,
    found_emails text[] DEFAULT '{}'::text[],
    found_phones text[] DEFAULT '{}'::text[],
    found_officers jsonb DEFAULT '[]'::jsonb,
    found_revenue numeric(14,2),
    found_assets numeric(14,2),
    found_giving numeric(14,2),
    found_programs text[],
    found_address jsonb,
    confidence numeric(3,2) DEFAULT 0,
    raw_data jsonb DEFAULT '{}'::jsonb,
    applied_to_db boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: form_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.form_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid,
    portal_url text NOT NULL,
    form_structure jsonb,
    field_mapping jsonb,
    is_multi_step boolean DEFAULT false NOT NULL,
    step_navigation jsonb,
    requires_login boolean DEFAULT false NOT NULL,
    requires_file_upload boolean DEFAULT false NOT NULL,
    file_upload_fields jsonb,
    last_verified_at timestamp with time zone,
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    auto_generated boolean DEFAULT false NOT NULL,
    field_count integer,
    automation_assessment jsonb
);


--
-- Name: foundation_directory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.foundation_directory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ein text NOT NULL,
    name text NOT NULL,
    dba text,
    city text,
    state text,
    zip text,
    ntee_code text,
    subsection_code text,
    foundation_type text,
    revenue_amount numeric(14,2),
    asset_amount numeric(14,2),
    ruling_date text,
    tax_period text,
    activity_codes text,
    organization_type text,
    status text,
    website text,
    email text,
    phone text,
    giving_total numeric(14,2),
    geographic_focus text,
    imported_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    enriched_at timestamp with time zone,
    enrichment_source text,
    officers jsonb DEFAULT '[]'::jsonb,
    programs text[],
    contact_emails text[] DEFAULT '{}'::text[],
    contact_phones text[] DEFAULT '{}'::text[],
    enrichment jsonb DEFAULT '{}'::jsonb,
    enriched_990_at timestamp with time zone,
    enriched_web_at timestamp with time zone,
    website_discovered_via text,
    embedding extensions.vector(1536)
);


--
-- Name: foundation_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.foundation_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    foundation_id uuid,
    avg_grant_size numeric,
    geographic_focus text[],
    funding_categories text[],
    computed_at timestamp with time zone DEFAULT now(),
    total_grants_made numeric,
    top_recipients jsonb
);


--
-- Name: fundability_deficiencies; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fundability_deficiencies (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    fundability_score_id uuid NOT NULL,
    category text NOT NULL,
    description text NOT NULL,
    impact_on_score integer,
    is_auto_fixable boolean DEFAULT false,
    fix_action text,
    fix_status text DEFAULT 'pending'::text,
    fixed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: fundability_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.fundability_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    opportunity_id uuid,
    overall_score integer,
    probability_without_fixes integer,
    probability_with_fixes integer,
    confidence text,
    deficiencies jsonb DEFAULT '[]'::jsonb,
    recommendation text,
    generated_at timestamp with time zone DEFAULT now()
);


--
-- Name: funder_credentials; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funder_credentials (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid NOT NULL,
    portal_url text NOT NULL,
    username text NOT NULL,
    encrypted_password text NOT NULL,
    mfa_secret text,
    login_method text DEFAULT 'form'::text NOT NULL,
    last_login_at timestamp with time zone,
    login_success boolean,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: funder_dna_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funder_dna_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid NOT NULL,
    requirement_patterns jsonb DEFAULT '{}'::jsonb NOT NULL,
    reward_patterns jsonb DEFAULT '{}'::jsonb NOT NULL,
    typical_award_range_min numeric,
    typical_award_range_max numeric,
    common_eligibility_themes text[],
    common_required_documents text[],
    sample_size integer DEFAULT 0 NOT NULL,
    confidence numeric,
    last_analyzed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: funder_giving_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funder_giving_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid,
    recipient_name text,
    recipient_ein text,
    amount numeric(12,2),
    purpose text,
    fiscal_year integer,
    source_filing_url text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: funder_intelligence; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funder_intelligence (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid NOT NULL,
    priorities text[],
    recent_grants jsonb,
    board_members jsonb,
    review_criteria text,
    funding_cycles text,
    average_grant_size numeric(12,2),
    total_annual_giving numeric(12,2),
    application_tips text,
    last_scraped_at timestamp with time zone,
    raw_data jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: funder_relationship_events; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funder_relationship_events (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid NOT NULL,
    event_type text NOT NULL,
    event_date timestamp with time zone DEFAULT now() NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT funder_relationship_events_event_type_check CHECK ((event_type = ANY (ARRAY['award'::text, 'application'::text, 'response'::text, 'outreach'::text, 'meeting'::text, 'rejection'::text])))
);


--
-- Name: funder_relationship_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funder_relationship_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid,
    score integer DEFAULT 0,
    events jsonb DEFAULT '[]'::jsonb,
    last_updated_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    relationship_score integer DEFAULT 0 NOT NULL,
    total_interactions integer DEFAULT 0 NOT NULL,
    successful_applications integer DEFAULT 0 NOT NULL,
    last_interaction_at timestamp with time zone,
    notes text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    trend text DEFAULT 'neutral'::text NOT NULL,
    recent_events jsonb DEFAULT '[]'::jsonb NOT NULL,
    is_stale boolean DEFAULT false NOT NULL,
    CONSTRAINT funder_relationship_scores_relationship_score_check CHECK (((relationship_score >= 0) AND (relationship_score <= 100))),
    CONSTRAINT funder_relationship_scores_trend_check CHECK ((trend = ANY (ARRAY['rising'::text, 'falling'::text, 'neutral'::text])))
);


--
-- Name: funder_relationship_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funder_relationship_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    funder_id uuid NOT NULL,
    source text NOT NULL,
    signal_type text NOT NULL,
    signal_summary text NOT NULL,
    signal_url text,
    signal_date date,
    relationship_score integer,
    mission_alignment integer,
    recommended_action text,
    recommended_deadline date,
    created_at timestamp with time zone DEFAULT now(),
    CONSTRAINT funder_relationship_signals_mission_alignment_check CHECK (((mission_alignment >= 0) AND (mission_alignment <= 100))),
    CONSTRAINT funder_relationship_signals_relationship_score_check CHECK (((relationship_score >= 0) AND (relationship_score <= 100))),
    CONSTRAINT funder_relationship_signals_signal_type_check CHECK ((signal_type = ANY (ARRAY['leadership_change'::text, 'board_appointment'::text, 'funding_priority_announcement'::text, 'program_expansion'::text, 'public_recognition'::text, '990_filing'::text]))),
    CONSTRAINT funder_relationship_signals_source_check CHECK ((source = ANY (ARRAY['news'::text, '990_filing'::text])))
);


--
-- Name: funders; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funders (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    category public.funder_category NOT NULL,
    description text,
    website text,
    giving_portal_url text,
    portal_login_status text,
    annual_giving_budget numeric(12,2),
    geographic_focus text,
    preferred_application_method text,
    has_giving_page boolean DEFAULT true,
    notes text,
    last_contacted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    portal_status text DEFAULT 'unknown'::text,
    portal_last_checked_at timestamp with time zone,
    portal_response_time_ms integer,
    type text,
    portal_review_status text,
    contact_email text,
    automation_level text DEFAULT 'assisted'::text,
    automation_notes text
);


--
-- Name: funding_forecasts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.funding_forecasts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    forecast_date date NOT NULL,
    forecast_period text NOT NULL,
    projected_min numeric,
    projected_max numeric,
    projected_most_likely numeric,
    confidence numeric,
    methodology text,
    factors jsonb DEFAULT '{}'::jsonb NOT NULL,
    key_risks text[],
    key_opportunities text[],
    recommended_actions text[],
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: grant_agreements; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grant_agreements (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid,
    organization_id uuid NOT NULL,
    funder_id uuid NOT NULL,
    amount_awarded numeric(12,2),
    award_type text,
    agreement_date timestamp with time zone,
    start_date timestamp with time zone,
    end_date timestamp with time zone,
    terms text,
    reporting_requirements jsonb,
    payment_schedule jsonb,
    status text DEFAULT 'pending'::text NOT NULL,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: grant_budgets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grant_budgets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid,
    total_budget numeric DEFAULT 0,
    personnel numeric DEFAULT 0,
    supplies numeric DEFAULT 0,
    equipment numeric DEFAULT 0,
    other numeric DEFAULT 0,
    period_start date,
    period_end date,
    created_at timestamp with time zone DEFAULT now(),
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    total_approved numeric,
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: grant_expenses; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grant_expenses (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    budget_id uuid,
    category text,
    description text,
    amount numeric NOT NULL,
    expense_date date,
    created_at timestamp with time zone DEFAULT now(),
    application_id uuid,
    receipt_url text
);


--
-- Name: grant_reconciliation_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.grant_reconciliation_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid NOT NULL,
    total_budget numeric,
    total_spent numeric,
    variance numeric,
    compliance_status text,
    generated_at timestamp with time zone DEFAULT now()
);


--
-- Name: historical_awards; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.historical_awards (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    recipient_name text,
    award_amount numeric(12,2),
    award_date date,
    awarding_agency text,
    description text,
    award_id text,
    source text DEFAULT 'usaspending.gov'::text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: impact_simulations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impact_simulations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    scenario_type text NOT NULL,
    scenario_params jsonb NOT NULL,
    simulation_result jsonb,
    confidence text,
    generated_at timestamp with time zone DEFAULT now() NOT NULL,
    created_by uuid
);


--
-- Name: impersonation_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.impersonation_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    admin_id uuid NOT NULL,
    target_org_id uuid NOT NULL,
    target_user_id uuid,
    started_at timestamp with time zone DEFAULT now(),
    ended_at timestamp with time zone,
    reason text NOT NULL,
    actions_taken text[]
);


--
-- Name: improvement_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.improvement_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proposal_type text NOT NULL,
    title text NOT NULL,
    description text NOT NULL,
    evidence text NOT NULL,
    expected_impact text NOT NULL,
    risk_level text,
    status text DEFAULT 'proposed'::text,
    confidence_score integer,
    proposed_at timestamp with time zone DEFAULT now(),
    reviewed_at timestamp with time zone,
    reviewed_by uuid,
    implemented_at timestamp with time zone
);


--
-- Name: integration_keys; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integration_keys (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    service_name text NOT NULL,
    encrypted_key text NOT NULL,
    is_active boolean DEFAULT true,
    last_validated_at timestamp with time zone,
    validation_status text DEFAULT 'pending'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: integrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.integrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    provider text NOT NULL,
    access_token text,
    refresh_token text,
    token_expires_at timestamp with time zone,
    connected_email text,
    scopes text[],
    is_active boolean DEFAULT true,
    last_sync_at timestamp with time zone,
    settings jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_budget_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_budget_patterns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    program_category text NOT NULL,
    grant_type text NOT NULL,
    line_items jsonb DEFAULT '[]'::jsonb NOT NULL,
    typical_percentages jsonb DEFAULT '{}'::jsonb,
    justification_examples jsonb DEFAULT '[]'::jsonb,
    source text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_budget_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_budget_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    budget_category text NOT NULL,
    subcategory text,
    justification_template text NOT NULL,
    federal_reference text,
    example_language text,
    source text,
    embedding extensions.vector(1536),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_evaluation_frameworks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_evaluation_frameworks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    framework_name text,
    kpis jsonb NOT NULL,
    data_collection_methods jsonb,
    reporting_frequency text,
    example_text text,
    source text,
    embedding extensions.vector(1536),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_funded_proposals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_funded_proposals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_url text,
    funder_name text,
    funder_type text,
    grant_program text,
    award_amount numeric(12,2),
    award_year integer,
    category text[],
    full_text text,
    reviewer_comments text,
    metadata jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_grant_dna_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_grant_dna_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proposal_id uuid,
    need_statement_score numeric(3,1),
    evidence_strength_score numeric(3,1),
    outcome_specificity_score numeric(3,1),
    evaluation_depth_score numeric(3,1),
    sustainability_score numeric(3,1),
    budget_alignment_score numeric(3,1),
    program_design_score numeric(3,1),
    reviewer_friendliness_score numeric(3,1),
    composite_score numeric(3,1),
    scoring_rationale jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_grantmaker_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_grantmaker_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    funder_id uuid,
    ein text,
    priorities text[],
    avg_award_amount numeric(12,2),
    award_range_min numeric(12,2),
    award_range_max numeric(12,2),
    geographic_focus text[],
    typical_language text,
    common_keywords text[],
    decision_timeline text,
    application_tips text,
    source text,
    last_updated_at timestamp with time zone DEFAULT now(),
    embedding extensions.vector(1536),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_logic_models; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_logic_models (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    category text NOT NULL,
    subcategory text,
    inputs jsonb NOT NULL,
    activities jsonb NOT NULL,
    outputs jsonb NOT NULL,
    outcomes jsonb NOT NULL,
    impact jsonb NOT NULL,
    source text,
    is_template boolean DEFAULT true,
    embedding extensions.vector(1536),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_narrative_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_narrative_patterns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pattern_type text NOT NULL,
    category text[],
    structure jsonb NOT NULL,
    example_ids uuid[],
    frequency integer DEFAULT 1,
    win_rate numeric(5,2),
    description text,
    embedding extensions.vector(1536),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_need_data; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_need_data (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_url text,
    data_type text NOT NULL,
    geographic_level text NOT NULL,
    state text,
    county text,
    city text,
    zip text,
    metric_name text NOT NULL,
    metric_value text NOT NULL,
    metric_year integer,
    context text,
    citation text NOT NULL,
    raw_data jsonb,
    embedding extensions.vector(1536),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_post_award_reports; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_post_award_reports (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_url text,
    funder_name text,
    grantee_name text,
    category text[],
    highlighted_outcomes text,
    reported_metrics jsonb,
    funder_language text,
    follow_on_funding boolean,
    full_text text,
    embedding extensions.vector(1536),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_proposal_sections; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_proposal_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    proposal_id uuid,
    section_type text NOT NULL,
    section_text text NOT NULL,
    quality_score numeric(3,1),
    embedding extensions.vector(1536),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: intelligence_scoring_rubrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.intelligence_scoring_rubrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    source_url text,
    funder_name text,
    grant_program text,
    category text[],
    dimensions jsonb NOT NULL,
    full_text text,
    embedding extensions.vector(1536),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: invoices; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.invoices (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    stripe_invoice_id text,
    amount_cents integer NOT NULL,
    currency text DEFAULT 'usd'::text,
    status text NOT NULL,
    description text,
    invoice_url text,
    period_start timestamp with time zone,
    period_end timestamp with time zone,
    paid_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: kb_extended_needs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.kb_extended_needs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    request_profile_id uuid,
    need_type text NOT NULL,
    details jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: knowledge_base; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_base (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    category public.knowledge_base_category NOT NULL,
    title text NOT NULL,
    content text NOT NULL,
    is_proven boolean DEFAULT false,
    proven_count integer DEFAULT 0,
    funder_categories public.funder_category[],
    keywords text[],
    version integer DEFAULT 1,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: knowledge_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_patterns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pattern_type text NOT NULL,
    category text,
    funder_name text,
    pattern_description text NOT NULL,
    success_rate numeric,
    sample_count integer,
    confidence text DEFAULT 'low'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: knowledge_queries; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.knowledge_queries (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    query_text text NOT NULL,
    results jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: marketplace_listings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_listings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    title text NOT NULL,
    description text,
    category public.funder_category NOT NULL,
    item_type text,
    quantity text,
    estimated_value numeric(12,2),
    geographic_scope text,
    status public.marketplace_listing_status DEFAULT 'active'::public.marketplace_listing_status NOT NULL,
    expires_at timestamp with time zone,
    is_seed_data boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: marketplace_matches; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.marketplace_matches (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    listing_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    match_reason text NOT NULL,
    status public.marketplace_match_status DEFAULT 'suggested'::public.marketplace_match_status NOT NULL,
    requested_at timestamp with time zone,
    responded_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: nonprofits; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.nonprofits (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    ein text NOT NULL,
    name text NOT NULL,
    city text,
    state text,
    zip text,
    ntee_code text,
    subsection_code text,
    foundation_type text,
    ruling_date text,
    revenue_amount numeric,
    asset_amount numeric,
    income_amount numeric,
    status text DEFAULT 'active'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    website text,
    phone text,
    officer_name text,
    officer_title text,
    officer_email text,
    mission text,
    employee_count integer,
    linkedin_url text,
    facebook_url text,
    twitter_url text,
    instagram_url text,
    staff_contacts text,
    contact_emails text,
    last_enriched_at timestamp with time zone,
    enrichment_tier integer DEFAULT 0
);


--
-- Name: notes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid,
    opportunity_id uuid,
    application_id uuid,
    content text NOT NULL,
    author_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT notes_exactly_one_parent CHECK ((num_nonnulls(funder_id, opportunity_id, application_id) = 1))
);


--
-- Name: onboarding_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.onboarding_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    step_number integer NOT NULL,
    step_name text NOT NULL,
    is_completed boolean DEFAULT false,
    completed_at timestamp with time zone,
    step_data jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: opportunities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid,
    name text NOT NULL,
    category public.funder_category NOT NULL,
    description text,
    amount_available numeric(12,2),
    amount_min numeric(12,2),
    amount_max numeric(12,2),
    deadline timestamp with time zone,
    url text,
    eligibility_requirements text,
    required_documents text[],
    application_method text,
    recurrence text,
    geographic_restrictions text,
    eligibility_score integer,
    recommendation text,
    recommendation_reasoning text,
    status public.opportunity_status DEFAULT 'open'::public.opportunity_status,
    source text,
    discovered_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    match_percentage integer DEFAULT 0,
    source_type text DEFAULT 'not_classified'::text,
    opportunity_documents jsonb,
    is_high_priority boolean DEFAULT false NOT NULL,
    match_mismatch_reasons text[],
    CONSTRAINT opportunities_eligibility_score_check CHECK (((eligibility_score >= 0) AND (eligibility_score <= 100)))
);


--
-- Name: opportunity_keywords; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_keywords (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    keyword text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: opportunity_probability_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.opportunity_probability_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    opportunity_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    overall_score integer DEFAULT 0,
    confidence text DEFAULT 'low'::text,
    factors jsonb DEFAULT '[]'::jsonb,
    recommendation text DEFAULT 'consider'::text,
    key_risks text[],
    key_strengths text[],
    estimated_roi text,
    time_to_complete text,
    computed_at timestamp with time zone DEFAULT now()
);


--
-- Name: org_autonomous_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_autonomous_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    auto_research_enabled boolean DEFAULT false,
    auto_score_enabled boolean DEFAULT false,
    auto_draft_enabled boolean DEFAULT false,
    auto_draft_threshold integer DEFAULT 70,
    auto_reputation_enabled boolean DEFAULT false,
    auto_relationship_enabled boolean DEFAULT false,
    auto_deadline_prediction_enabled boolean DEFAULT false,
    auto_followup_enabled boolean DEFAULT false,
    max_auto_drafts_per_night integer DEFAULT 10,
    created_at timestamp with time zone DEFAULT now(),
    auto_fundability_enabled boolean DEFAULT false,
    auto_donor_intent_enabled boolean DEFAULT false,
    auto_community_need_enabled boolean DEFAULT false,
    auto_strategic_advisor_enabled boolean DEFAULT false,
    notify_on_auto_draft boolean DEFAULT true,
    notify_on_high_score boolean DEFAULT true,
    notify_digest_time text DEFAULT '07:00'::text,
    updated_at timestamp with time zone DEFAULT now(),
    auto_autoapply_enabled boolean DEFAULT false,
    max_nightly_autoapply_submissions integer DEFAULT 50,
    auto_deploy_disaster_response boolean DEFAULT false NOT NULL
);


--
-- Name: org_documents; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_documents (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    document_type text NOT NULL,
    display_name text NOT NULL,
    storage_path text NOT NULL,
    file_name text NOT NULL,
    file_size integer,
    mime_type text,
    is_current boolean DEFAULT true NOT NULL,
    expires_at timestamp with time zone,
    uploaded_by uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: org_learning_contributions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_learning_contributions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    contribution_type text NOT NULL,
    pattern_id uuid,
    anonymized_at timestamp with time zone DEFAULT now()
);


--
-- Name: org_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_settings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    autoapply_mode text DEFAULT 'manual'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    CONSTRAINT org_settings_autoapply_mode_check CHECK ((autoapply_mode = ANY (ARRAY['manual'::text, 'semi_auto'::text, 'autonomous'::text])))
);


--
-- Name: org_usage_summary; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.org_usage_summary (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    period_date date NOT NULL,
    ai_tokens_used integer DEFAULT 0,
    ai_cost_cents integer DEFAULT 0,
    drafts_generated integer DEFAULT 0,
    submissions_attempted integer DEFAULT 0,
    submissions_succeeded integer DEFAULT 0,
    agent_runs integer DEFAULT 0,
    storage_bytes_used bigint DEFAULT 0,
    active_users integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: organizational_digital_twins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizational_digital_twins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid,
    organization_id uuid NOT NULL,
    mission text,
    vision text,
    service_areas text[],
    programs jsonb DEFAULT '[]'::jsonb,
    financial_profile jsonb DEFAULT '{}'::jsonb,
    board_composition jsonb DEFAULT '[]'::jsonb,
    proven_narrative_patterns text[],
    key_strengths text[],
    known_weaknesses text[],
    twin_completeness_score integer DEFAULT 0,
    last_rebuilt_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: organizations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.organizations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    dba text,
    ein text,
    tax_status text,
    mission_statement text,
    vision_statement text,
    founding_date date,
    founder_name text,
    founder_bio text,
    service_area text,
    target_population text,
    annual_budget numeric(12,2),
    total_staff integer DEFAULT 0,
    total_volunteers integer DEFAULT 0,
    website text,
    phone text,
    email text,
    address_line1 text,
    address_line2 text,
    city text,
    state text,
    zip text,
    logo_url text,
    stripe_customer_id text,
    subscription_tier text DEFAULT 'free'::text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    onboarding_completed boolean DEFAULT false NOT NULL,
    onboarding_completed_at timestamp with time zone,
    onboarding_step integer DEFAULT 0 NOT NULL,
    contact_email text,
    white_label_config jsonb DEFAULT '{}'::jsonb,
    onboarding_progress jsonb DEFAULT '{}'::jsonb NOT NULL,
    donor_discovery_scoring_weights jsonb DEFAULT '{}'::jsonb,
    extended_profile jsonb DEFAULT '{}'::jsonb NOT NULL
);


--
-- Name: outcomes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outcomes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid NOT NULL,
    result public.outcome_result NOT NULL,
    awarded_amount numeric(12,2),
    requested_amount numeric(12,2),
    funder_feedback text,
    denial_reason text,
    narrative_snapshot text,
    funder_category public.funder_category,
    opportunity_category public.funder_category,
    keywords_used text[],
    recorded_by uuid,
    recorded_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now(),
    embedding extensions.vector(1536)
);


--
-- Name: outreach_contacts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_contacts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    company_name text NOT NULL,
    contact_name text,
    email text,
    phone text,
    contact_form_url text,
    source_url text,
    company_type text,
    giving_likelihood text,
    campaign_id uuid,
    status text DEFAULT 'new'::text,
    converted_to_funder_id uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: outreach_template_variants; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_template_variants (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    template_id uuid NOT NULL,
    organization_id uuid NOT NULL,
    variant_name text NOT NULL,
    subject_override text,
    body_override text NOT NULL,
    is_active boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: outreach_templates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.outreach_templates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    channel text NOT NULL,
    subject text,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT outreach_templates_channel_check CHECK ((channel = ANY (ARRAY['email'::text, 'linkedin'::text, 'phone_script'::text, 'physical_mail'::text])))
);


--
-- Name: pig_edges; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pig_edges (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source_node_id uuid,
    target_node_id uuid,
    relationship_type text NOT NULL,
    weight numeric DEFAULT 1.0 NOT NULL,
    evidence text,
    verified boolean DEFAULT false NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    discovered_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pig_nodes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pig_nodes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    node_type text NOT NULL,
    entity_id uuid NOT NULL,
    entity_table text NOT NULL,
    label text NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: pipeline_history; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pipeline_history (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid NOT NULL,
    from_stage public.pipeline_stage,
    to_stage public.pipeline_stage NOT NULL,
    changed_by uuid,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: pitch_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pitch_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid NOT NULL,
    request_profile_id uuid,
    personalized_pitch text NOT NULL,
    pitch_hash text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone DEFAULT (now() + '30 days'::interval)
);


--
-- Name: platform_admins; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_admins (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    email text NOT NULL,
    full_name text NOT NULL,
    platform_role public.platform_role DEFAULT 'staff_readonly'::public.platform_role NOT NULL,
    permissions public.staff_permission[] DEFAULT '{}'::public.staff_permission[],
    is_active boolean DEFAULT true,
    last_login_at timestamp with time zone,
    invited_by uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: platform_config; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_config (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    key text NOT NULL,
    value text NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: platform_learning_patterns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_learning_patterns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    pattern_type text NOT NULL,
    funder_category text,
    ntee_code text,
    pattern_content text NOT NULL,
    success_rate numeric,
    sample_count integer DEFAULT 1,
    avg_award_amount numeric,
    winning_examples jsonb DEFAULT '[]'::jsonb,
    last_updated timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: platform_tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.platform_tasks (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    title text NOT NULL,
    description text,
    assigned_to uuid,
    assigned_by uuid,
    status public.task_status DEFAULT 'open'::public.task_status,
    priority public.task_priority DEFAULT 'medium'::public.task_priority,
    category text DEFAULT 'general'::text,
    related_tenant_id uuid,
    related_entity_type text,
    related_entity_id uuid,
    due_date timestamp with time zone,
    completed_at timestamp with time zone,
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.profiles (
    id uuid NOT NULL,
    organization_id uuid NOT NULL,
    email text NOT NULL,
    full_name text,
    role public.user_role DEFAULT 'viewer'::public.user_role NOT NULL,
    avatar_url text,
    last_login_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    command_center_layout jsonb,
    restricted_onboarding_edit boolean DEFAULT false NOT NULL
);


--
-- Name: programs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.programs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    description text,
    budget numeric(12,2),
    beneficiaries_served integer,
    start_date date,
    status text DEFAULT 'active'::text,
    impact_metrics jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: prospect_lists; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospect_lists (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    source text,
    total_prospects integer DEFAULT 0,
    imported_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: prospects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.prospects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    list_id uuid,
    ein text,
    org_name text NOT NULL,
    org_type text,
    email text,
    website text,
    city text,
    state text,
    zip text,
    annual_revenue numeric(14,2),
    employee_count integer,
    ntee_code text,
    subsection_code text,
    status text DEFAULT 'active'::text,
    suppressed boolean DEFAULT false,
    suppressed_reason text,
    suppressed_at timestamp with time zone,
    last_contacted_at timestamp with time zone,
    total_emails_sent integer DEFAULT 0,
    has_replied boolean DEFAULT false,
    has_converted boolean DEFAULT false,
    converted_org_id uuid,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: proven_narratives; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.proven_narratives (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    outcome_id uuid NOT NULL,
    knowledge_base_id uuid,
    narrative_text text NOT NULL,
    section_type text,
    funder_category public.funder_category,
    success_count integer DEFAULT 1,
    effectiveness_score numeric(5,2),
    last_used_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    success_patterns jsonb
);


--
-- Name: relationship_memory; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relationship_memory (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    entity_type text DEFAULT 'funder'::text NOT NULL,
    memory_type text NOT NULL,
    content text NOT NULL,
    signal_date date,
    actioned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: relationship_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.relationship_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    entity_id uuid NOT NULL,
    entity_type text DEFAULT 'funder'::text NOT NULL,
    recommendation_text text NOT NULL,
    urgency text DEFAULT 'normal'::text NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: renewals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.renewals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    funder_id uuid,
    renewal_type text DEFAULT 'annual'::text NOT NULL,
    reporting_deadline date,
    renewal_window_start date,
    renewal_window_end date,
    compliance_status text DEFAULT 'pending'::text NOT NULL,
    compliance_notes text,
    auto_narrative_draft text,
    alert_sent_60d boolean DEFAULT false NOT NULL,
    alert_sent_30d boolean DEFAULT false NOT NULL,
    alert_sent_14d boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reputation_alerts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reputation_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    signal_id uuid,
    status text DEFAULT 'unread'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: reputation_signals; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.reputation_signals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    entity_id uuid NOT NULL,
    entity_type text NOT NULL,
    signal_type text NOT NULL,
    severity text DEFAULT 'yellow'::text NOT NULL,
    headline text NOT NULL,
    summary text,
    source_url text,
    signal_date date,
    verified boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: request_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.request_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    request_type text NOT NULL,
    priority integer DEFAULT 100 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    needs_description text NOT NULL,
    specific_requirements jsonb DEFAULT '{}'::jsonb,
    target_funder_categories text[],
    target_funder_types text[],
    pitch_template text,
    form_field_overrides jsonb DEFAULT '{}'::jsonb,
    success_criteria text,
    min_value numeric(12,2),
    max_value numeric(12,2),
    value_unit text DEFAULT 'usd'::text,
    geographic_requirements jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: research_cache; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.research_cache (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    url text NOT NULL,
    content text,
    fetched_at timestamp with time zone DEFAULT now(),
    expires_at timestamp with time zone NOT NULL,
    status_code integer,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: roi_insights; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roi_insights (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    insight_type text NOT NULL,
    insight_description text NOT NULL,
    winning_pattern text,
    losing_pattern text,
    sample_size integer,
    confidence numeric,
    recommended_action text,
    generated_at timestamp with time zone DEFAULT now()
);


--
-- Name: sales_campaign_steps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_campaign_steps (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    step_number integer NOT NULL,
    subject_template text NOT NULL,
    body_template text NOT NULL,
    delay_days integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: sales_campaigns; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_campaigns (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    description text,
    list_id uuid,
    status text DEFAULT 'draft'::text,
    sending_domain_ids uuid[] DEFAULT '{}'::uuid[],
    daily_send_target integer DEFAULT 20,
    send_window_start integer DEFAULT 9,
    send_window_end integer DEFAULT 17,
    send_timezone text DEFAULT 'America/Chicago'::text,
    total_sent integer DEFAULT 0,
    total_opened integer DEFAULT 0,
    total_replied integer DEFAULT 0,
    total_unsubscribed integer DEFAULT 0,
    total_bounced integer DEFAULT 0,
    filter_criteria jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: sales_sends; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sales_sends (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    campaign_id uuid NOT NULL,
    step_id uuid NOT NULL,
    prospect_id uuid NOT NULL,
    sending_domain_id uuid,
    from_address text NOT NULL,
    to_address text NOT NULL,
    subject text NOT NULL,
    body_html text,
    status text DEFAULT 'queued'::text,
    sent_at timestamp with time zone,
    opened_at timestamp with time zone,
    replied_at timestamp with time zone,
    bounced_at timestamp with time zone,
    bounce_type text,
    unsubscribed_at timestamp with time zone,
    resend_message_id text,
    error_message text,
    scheduled_for timestamp with time zone,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: scrape_jobs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scrape_jobs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    keyword text NOT NULL,
    target_domain text,
    output_schema jsonb NOT NULL,
    status text DEFAULT 'pending'::text,
    urls_discovered integer DEFAULT 0,
    urls_processed integer DEFAULT 0,
    results_found integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    completed_at timestamp with time zone
);


--
-- Name: scrape_results; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scrape_results (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    job_id uuid,
    source_url text NOT NULL,
    extracted_data jsonb NOT NULL,
    confidence text,
    fetched_at timestamp with time zone DEFAULT now(),
    fetch_error text
);


--
-- Name: scraping_targets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.scraping_targets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    url text NOT NULL,
    description text,
    scrape_schedule text DEFAULT 'weekly'::text,
    last_scraped_at timestamp with time zone,
    last_success_at timestamp with time zone,
    failure_count integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: search_profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.search_profiles (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    name text NOT NULL,
    keywords text[] NOT NULL,
    categories public.funder_category[],
    geographic_scope text,
    min_amount numeric(12,2),
    max_amount numeric(12,2),
    recurrence_preference text,
    is_active boolean DEFAULT true,
    last_run_at timestamp with time zone,
    results_count integer DEFAULT 0,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    agent_settings jsonb DEFAULT '{}'::jsonb,
    source_type_filters jsonb DEFAULT '[]'::jsonb NOT NULL,
    focus_areas jsonb DEFAULT '[]'::jsonb NOT NULL,
    geographic_scopes text[] DEFAULT '{}'::text[] NOT NULL,
    eligibility_filters jsonb DEFAULT '{}'::jsonb NOT NULL,
    populations_served text[] DEFAULT '{}'::text[] NOT NULL,
    excluded_categories public.funder_category[] DEFAULT '{}'::public.funder_category[] NOT NULL,
    excluded_funders text[] DEFAULT '{}'::text[] NOT NULL
);


--
-- Name: sending_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.sending_domains (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    domain text NOT NULL,
    provider text DEFAULT 'resend'::text NOT NULL,
    api_key_encrypted text,
    dns_verified boolean DEFAULT false,
    warmup_status text DEFAULT 'cold'::text,
    warmup_started_at timestamp with time zone,
    current_daily_limit integer DEFAULT 5,
    target_daily_limit integer DEFAULT 50,
    warmup_day integer DEFAULT 0,
    total_sent integer DEFAULT 0,
    total_bounced integer DEFAULT 0,
    total_complained integer DEFAULT 0,
    bounce_rate numeric(5,4) DEFAULT 0,
    complaint_rate numeric(5,4) DEFAULT 0,
    is_active boolean DEFAULT true,
    health_status text DEFAULT 'unknown'::text,
    last_health_check_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: simulation_scenarios; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.simulation_scenarios (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    scenario_name text NOT NULL,
    scenario_type text NOT NULL,
    variables jsonb DEFAULT '{}'::jsonb NOT NULL,
    projected_revenue numeric,
    projected_grants integer,
    probability_improvement numeric,
    cost_estimate numeric,
    roi_multiple numeric,
    payback_months integer,
    risk_factors jsonb DEFAULT '[]'::jsonb,
    confidence text,
    generated_at timestamp with time zone DEFAULT now()
);


--
-- Name: solicitation_registrations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.solicitation_registrations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    state text NOT NULL,
    registration_number text,
    registered_at timestamp with time zone,
    expires_at timestamp with time zone,
    status text DEFAULT 'active'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: strategic_recommendations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.strategic_recommendations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    org_id uuid NOT NULL,
    recommendation_category text NOT NULL,
    title text NOT NULL,
    recommendation text NOT NULL,
    reasoning text NOT NULL,
    urgency text DEFAULT 'normal'::text,
    time_sensitivity text,
    expected_impact text,
    confidence_score integer,
    data_basis jsonb DEFAULT '{}'::jsonb,
    status text DEFAULT 'pending'::text,
    generated_at timestamp with time zone DEFAULT now(),
    actioned_at timestamp with time zone
);


--
-- Name: submission_queue; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submission_queue (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    funder_id uuid,
    priority integer DEFAULT 100 NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    automation_mode text DEFAULT 'manual'::text NOT NULL,
    scheduled_for timestamp with time zone,
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    submission_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    request_profile_id uuid,
    pause_reason text,
    paused_at timestamp with time zone,
    paused_screenshot_path text,
    paused_history jsonb DEFAULT '[]'::jsonb,
    resume_count integer DEFAULT 0,
    error_message text,
    risk_score integer,
    risk_factors jsonb,
    CONSTRAINT submission_queue_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'skipped'::text, 'paused_verification'::text, 'requires_account_setup'::text, 'pending_manual'::text])))
);


--
-- Name: submission_receipts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submission_receipts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid,
    organization_id uuid NOT NULL,
    receipt_pdf_path text,
    receipt_data jsonb NOT NULL,
    generated_at timestamp with time zone DEFAULT now()
);


--
-- Name: submission_variables; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submission_variables (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    application_id uuid NOT NULL,
    org_id uuid NOT NULL,
    submission_day_of_week integer,
    days_before_deadline integer,
    word_count integer,
    attachment_count integer,
    has_budget boolean DEFAULT false,
    has_logic_model boolean DEFAULT false,
    has_board_list boolean DEFAULT false,
    narrative_readability_score numeric,
    prompt_version text,
    outcome_result text,
    outcome_amount numeric,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: subscriptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.subscriptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    stripe_subscription_id text,
    stripe_customer_id text,
    tier public.subscription_tier DEFAULT 'free'::public.subscription_tier NOT NULL,
    status text DEFAULT 'active'::text NOT NULL,
    current_period_start timestamp with time zone,
    current_period_end timestamp with time zone,
    cancel_at_period_end boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: success_probability_scores; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.success_probability_scores (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    application_id uuid,
    probability_score numeric(5,2),
    factors jsonb DEFAULT '{}'::jsonb,
    calculated_at timestamp with time zone DEFAULT now()
);


--
-- Name: suppression_list; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.suppression_list (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email text NOT NULL,
    reason text NOT NULL,
    source text,
    added_at timestamp with time zone DEFAULT now()
);


--
-- Name: synced_email_messages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.synced_email_messages (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    thread_id uuid NOT NULL,
    gmail_message_id text NOT NULL,
    from_email text,
    from_name text,
    to_emails text[],
    cc_emails text[],
    subject text,
    body_text text,
    body_html text,
    sent_at timestamp with time zone,
    has_attachments boolean DEFAULT false,
    attachment_names text[],
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: synced_email_threads; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.synced_email_threads (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    gmail_thread_id text NOT NULL,
    subject text,
    snippet text,
    last_message_at timestamp with time zone,
    message_count integer DEFAULT 0,
    is_read boolean DEFAULT false,
    labels text[],
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: system_errors; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_errors (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    source text NOT NULL,
    error_type text NOT NULL,
    message text NOT NULL,
    stack_trace text,
    organization_id uuid,
    user_id uuid,
    route text,
    request_body jsonb,
    severity text DEFAULT 'error'::text,
    is_resolved boolean DEFAULT false,
    resolved_by uuid,
    resolved_at timestamp with time zone,
    resolution_notes text,
    occurrence_count integer DEFAULT 1,
    first_seen_at timestamp with time zone DEFAULT now(),
    last_seen_at timestamp with time zone DEFAULT now(),
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: team_activity_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.team_activity_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    user_id uuid NOT NULL,
    action text NOT NULL,
    entity_type text,
    entity_id uuid,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: usage_metrics; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_metrics (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    metric_date date DEFAULT CURRENT_DATE NOT NULL,
    metric_name text NOT NULL,
    metric_value bigint DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: usage_tracking; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.usage_tracking (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    resource_type text NOT NULL,
    period_start date NOT NULL,
    period_end date NOT NULL,
    count integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: user_invitations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.user_invitations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    email text NOT NULL,
    role public.user_role DEFAULT 'viewer'::public.user_role NOT NULL,
    token uuid DEFAULT gen_random_uuid() NOT NULL,
    status public.invitation_status DEFAULT 'pending'::public.invitation_status NOT NULL,
    invited_by uuid,
    accepted_by uuid,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);


--
-- Name: validations; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.validations (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    opportunity_id uuid NOT NULL,
    provider text NOT NULL,
    model text,
    verdict public.validation_verdict NOT NULL,
    confidence integer DEFAULT 0 NOT NULL,
    details jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_by uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT validations_confidence_check CHECK (((confidence >= 0) AND (confidence <= 100)))
);


--
-- Name: webhook_configs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.webhook_configs (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    organization_id uuid NOT NULL,
    webhook_type text DEFAULT 'slack'::text NOT NULL,
    webhook_url text NOT NULL,
    events text[] DEFAULT '{submission_completed,submission_failed}'::text[] NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now()
);


--
-- Name: worker_status; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.worker_status (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    worker_id text NOT NULL,
    status text DEFAULT 'online'::text NOT NULL,
    last_heartbeat_at timestamp with time zone DEFAULT now() NOT NULL,
    started_at timestamp with time zone DEFAULT now() NOT NULL,
    current_item_id uuid,
    items_processed integer DEFAULT 0 NOT NULL,
    items_failed integer DEFAULT 0 NOT NULL,
    version text,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea
)
PARTITION BY RANGE (inserted_at);


--
-- Name: messages_2026_08_18; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_18 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_19; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_19 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_20; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_20 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_21; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_21 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_22; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_22 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_23; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_23 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: messages_2026_08_24; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.messages_2026_08_24 (
    topic text NOT NULL,
    extension text NOT NULL,
    payload jsonb,
    event text,
    private boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    inserted_at timestamp without time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    binary_payload bytea,
    CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL)))
);


--
-- Name: schema_migrations; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.schema_migrations (
    version bigint NOT NULL,
    inserted_at timestamp(0) without time zone
);


--
-- Name: subscription; Type: TABLE; Schema: realtime; Owner: -
--

CREATE TABLE realtime.subscription (
    id bigint NOT NULL,
    subscription_id uuid NOT NULL,
    entity regclass NOT NULL,
    filters realtime.user_defined_filter[] DEFAULT '{}'::realtime.user_defined_filter[] NOT NULL,
    claims jsonb NOT NULL,
    claims_role regrole GENERATED ALWAYS AS (realtime.to_regrole((claims ->> 'role'::text))) STORED NOT NULL,
    created_at timestamp without time zone DEFAULT timezone('utc'::text, now()) NOT NULL,
    action_filter text DEFAULT '*'::text,
    selected_columns text[],
    CONSTRAINT subscription_action_filter_check CHECK ((action_filter = ANY (ARRAY['*'::text, 'INSERT'::text, 'UPDATE'::text, 'DELETE'::text])))
);


--
-- Name: subscription_id_seq; Type: SEQUENCE; Schema: realtime; Owner: -
--

ALTER TABLE realtime.subscription ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME realtime.subscription_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1
);


--
-- Name: buckets; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets (
    id text NOT NULL,
    name text NOT NULL,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    public boolean DEFAULT false,
    avif_autodetection boolean DEFAULT false,
    file_size_limit bigint,
    allowed_mime_types text[],
    owner_id text,
    type storage.buckettype DEFAULT 'STANDARD'::storage.buckettype NOT NULL,
    versioning_status text DEFAULT 'DISABLED'::text NOT NULL,
    CONSTRAINT buckets_versioning_dark_check CHECK ((versioning_status = 'DISABLED'::text)),
    CONSTRAINT buckets_versioning_standard_only_check CHECK (((type = 'STANDARD'::storage.buckettype) OR (versioning_status = 'DISABLED'::text))),
    CONSTRAINT buckets_versioning_status_check CHECK ((versioning_status = ANY (ARRAY['DISABLED'::text, 'ENABLED'::text, 'SUSPENDED'::text])))
);


--
-- Name: COLUMN buckets.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.buckets.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: buckets_analytics; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_analytics (
    name text NOT NULL,
    type storage.buckettype DEFAULT 'ANALYTICS'::storage.buckettype NOT NULL,
    format text DEFAULT 'ICEBERG'::text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: buckets_vectors; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.buckets_vectors (
    id text NOT NULL,
    type storage.buckettype DEFAULT 'VECTOR'::storage.buckettype NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: migrations; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.migrations (
    id integer NOT NULL,
    name character varying(100) NOT NULL,
    hash character varying(40) NOT NULL,
    executed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


--
-- Name: objects; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.objects (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    bucket_id text,
    name text,
    owner uuid,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    last_accessed_at timestamp with time zone DEFAULT now(),
    metadata jsonb,
    path_tokens text[] GENERATED ALWAYS AS (string_to_array(name, '/'::text)) STORED,
    version text,
    owner_id text,
    user_metadata jsonb,
    archived_at timestamp with time zone,
    is_delete_marker boolean DEFAULT false NOT NULL,
    is_versioned boolean DEFAULT false NOT NULL
);


--
-- Name: COLUMN objects.owner; Type: COMMENT; Schema: storage; Owner: -
--

COMMENT ON COLUMN storage.objects.owner IS 'Field is deprecated, use owner_id instead';


--
-- Name: s3_multipart_uploads; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads (
    id text NOT NULL,
    in_progress_size bigint DEFAULT 0 NOT NULL,
    upload_signature text NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    version text NOT NULL,
    owner_id text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    user_metadata jsonb,
    metadata jsonb
);


--
-- Name: s3_multipart_uploads_parts; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.s3_multipart_uploads_parts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    upload_id text NOT NULL,
    size bigint DEFAULT 0 NOT NULL,
    part_number integer NOT NULL,
    bucket_id text NOT NULL,
    key text NOT NULL COLLATE pg_catalog."C",
    etag text NOT NULL,
    owner_id text,
    version text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: vector_indexes; Type: TABLE; Schema: storage; Owner: -
--

CREATE TABLE storage.vector_indexes (
    id text DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL COLLATE pg_catalog."C",
    bucket_id text NOT NULL,
    data_type text NOT NULL,
    dimension integer NOT NULL,
    distance_metric text NOT NULL,
    metadata_configuration jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: messages_2026_08_18; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_18 FOR VALUES FROM ('2026-08-18 00:00:00') TO ('2026-08-19 00:00:00');


--
-- Name: messages_2026_08_19; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_19 FOR VALUES FROM ('2026-08-19 00:00:00') TO ('2026-08-20 00:00:00');


--
-- Name: messages_2026_08_20; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_20 FOR VALUES FROM ('2026-08-20 00:00:00') TO ('2026-08-21 00:00:00');


--
-- Name: messages_2026_08_21; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_21 FOR VALUES FROM ('2026-08-21 00:00:00') TO ('2026-08-22 00:00:00');


--
-- Name: messages_2026_08_22; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_22 FOR VALUES FROM ('2026-08-22 00:00:00') TO ('2026-08-23 00:00:00');


--
-- Name: messages_2026_08_23; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_23 FOR VALUES FROM ('2026-08-23 00:00:00') TO ('2026-08-24 00:00:00');


--
-- Name: messages_2026_08_24; Type: TABLE ATTACH; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages ATTACH PARTITION realtime.messages_2026_08_24 FOR VALUES FROM ('2026-08-24 00:00:00') TO ('2026-08-25 00:00:00');


--
-- Name: refresh_tokens id; Type: DEFAULT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens ALTER COLUMN id SET DEFAULT nextval('auth.refresh_tokens_id_seq'::regclass);


--
-- Name: mfa_amr_claims amr_id_pk; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT amr_id_pk PRIMARY KEY (id);


--
-- Name: audit_log_entries audit_log_entries_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.audit_log_entries
    ADD CONSTRAINT audit_log_entries_pkey PRIMARY KEY (id);


--
-- Name: custom_oauth_providers custom_oauth_providers_identifier_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_identifier_key UNIQUE (identifier);


--
-- Name: custom_oauth_providers custom_oauth_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.custom_oauth_providers
    ADD CONSTRAINT custom_oauth_providers_pkey PRIMARY KEY (id);


--
-- Name: flow_state flow_state_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.flow_state
    ADD CONSTRAINT flow_state_pkey PRIMARY KEY (id);


--
-- Name: identities identities_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_pkey PRIMARY KEY (id);


--
-- Name: identities identities_provider_id_provider_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_provider_id_provider_unique UNIQUE (provider_id, provider);


--
-- Name: instances instances_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.instances
    ADD CONSTRAINT instances_pkey PRIMARY KEY (id);


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_authentication_method_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_authentication_method_pkey UNIQUE (session_id, authentication_method);


--
-- Name: mfa_challenges mfa_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_pkey PRIMARY KEY (id);


--
-- Name: mfa_factors mfa_factors_last_challenged_at_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_last_challenged_at_key UNIQUE (last_challenged_at);


--
-- Name: mfa_factors mfa_factors_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_pkey PRIMARY KEY (id);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_code_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_code_key UNIQUE (authorization_code);


--
-- Name: oauth_authorizations oauth_authorizations_authorization_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_authorization_id_key UNIQUE (authorization_id);


--
-- Name: oauth_authorizations oauth_authorizations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_pkey PRIMARY KEY (id);


--
-- Name: oauth_client_states oauth_client_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_client_states
    ADD CONSTRAINT oauth_client_states_pkey PRIMARY KEY (id);


--
-- Name: oauth_clients oauth_clients_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_clients
    ADD CONSTRAINT oauth_clients_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_pkey PRIMARY KEY (id);


--
-- Name: oauth_consents oauth_consents_user_client_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_client_unique UNIQUE (user_id, client_id);


--
-- Name: one_time_tokens one_time_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_pkey PRIMARY KEY (id);


--
-- Name: refresh_tokens refresh_tokens_token_unique; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_token_unique UNIQUE (token);


--
-- Name: saml_providers saml_providers_entity_id_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_entity_id_key UNIQUE (entity_id);


--
-- Name: saml_providers saml_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_pkey PRIMARY KEY (id);


--
-- Name: saml_relay_states saml_relay_states_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_pkey PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: sessions sessions_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_pkey PRIMARY KEY (id);


--
-- Name: sso_domains sso_domains_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_pkey PRIMARY KEY (id);


--
-- Name: sso_providers sso_providers_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_providers
    ADD CONSTRAINT sso_providers_pkey PRIMARY KEY (id);


--
-- Name: users users_phone_key; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_phone_key UNIQUE (phone);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: webauthn_challenges webauthn_challenges_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_pkey PRIMARY KEY (id);


--
-- Name: webauthn_credentials webauthn_credentials_pkey; Type: CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_pkey PRIMARY KEY (id);


--
-- Name: adapter_usage_log adapter_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.adapter_usage_log
    ADD CONSTRAINT adapter_usage_log_pkey PRIMARY KEY (id);


--
-- Name: agent_configurations agent_configurations_org_id_agent_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_configurations
    ADD CONSTRAINT agent_configurations_org_id_agent_id_key UNIQUE (organization_id, agent_id);


--
-- Name: agent_configurations agent_configurations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_configurations
    ADD CONSTRAINT agent_configurations_pkey PRIMARY KEY (id);


--
-- Name: agent_decisions agent_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_decisions
    ADD CONSTRAINT agent_decisions_pkey PRIMARY KEY (id);


--
-- Name: agent_performance_metrics agent_performance_metrics_agent_id_metric_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_performance_metrics
    ADD CONSTRAINT agent_performance_metrics_agent_id_metric_date_key UNIQUE (agent_id, metric_date);


--
-- Name: agent_performance_metrics agent_performance_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_performance_metrics
    ADD CONSTRAINT agent_performance_metrics_pkey PRIMARY KEY (id);


--
-- Name: agent_queue agent_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_queue
    ADD CONSTRAINT agent_queue_pkey PRIMARY KEY (id);


--
-- Name: agent_registry agent_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_registry
    ADD CONSTRAINT agent_registry_pkey PRIMARY KEY (agent_id);


--
-- Name: agent_runs agent_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_log ai_usage_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_pkey PRIMARY KEY (id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY (id);


--
-- Name: application_documents application_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_documents
    ADD CONSTRAINT application_documents_pkey PRIMARY KEY (id);


--
-- Name: applications applications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_pkey PRIMARY KEY (id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: auto_queue_config auto_queue_config_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_queue_config
    ADD CONSTRAINT auto_queue_config_organization_id_key UNIQUE (organization_id);


--
-- Name: auto_queue_config auto_queue_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_queue_config
    ADD CONSTRAINT auto_queue_config_pkey PRIMARY KEY (id);


--
-- Name: autoapply_confirmation_ambiguous_matches autoapply_confirmation_ambiguous_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_confirmation_ambiguous_matches
    ADD CONSTRAINT autoapply_confirmation_ambiguous_matches_pkey PRIMARY KEY (id);


--
-- Name: autoapply_confirmation_processed_messages autoapply_confirmation_processed_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_confirmation_processed_messages
    ADD CONSTRAINT autoapply_confirmation_processed_messages_pkey PRIMARY KEY (gmail_message_id);


--
-- Name: autoapply_follow_ups autoapply_follow_ups_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_follow_ups
    ADD CONSTRAINT autoapply_follow_ups_pkey PRIMARY KEY (id);


--
-- Name: autoapply_review_queue autoapply_review_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_review_queue
    ADD CONSTRAINT autoapply_review_queue_pkey PRIMARY KEY (id);


--
-- Name: autoapply_screenshots autoapply_screenshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_screenshots
    ADD CONSTRAINT autoapply_screenshots_pkey PRIMARY KEY (id);


--
-- Name: autoapply_submissions autoapply_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_submissions
    ADD CONSTRAINT autoapply_submissions_pkey PRIMARY KEY (id);


--
-- Name: automation_notifications automation_notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_notifications
    ADD CONSTRAINT automation_notifications_pkey PRIMARY KEY (id);


--
-- Name: automation_queue automation_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_queue
    ADD CONSTRAINT automation_queue_pkey PRIMARY KEY (id);


--
-- Name: automation_screenshots automation_screenshots_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_screenshots
    ADD CONSTRAINT automation_screenshots_pkey PRIMARY KEY (id);


--
-- Name: automation_sessions automation_sessions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_sessions
    ADD CONSTRAINT automation_sessions_pkey PRIMARY KEY (id);


--
-- Name: automation_steps automation_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_steps
    ADD CONSTRAINT automation_steps_pkey PRIMARY KEY (id);


--
-- Name: autonomous_triggers autonomous_triggers_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autonomous_triggers
    ADD CONSTRAINT autonomous_triggers_pkey PRIMARY KEY (id);


--
-- Name: board_meeting_packets board_meeting_packets_meeting_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_meeting_packets
    ADD CONSTRAINT board_meeting_packets_meeting_id_unique UNIQUE (meeting_id);


--
-- Name: board_meeting_packets board_meeting_packets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_meeting_packets
    ADD CONSTRAINT board_meeting_packets_pkey PRIMARY KEY (id);


--
-- Name: board_meetings board_meetings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_meetings
    ADD CONSTRAINT board_meetings_pkey PRIMARY KEY (id);


--
-- Name: board_members board_members_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_members
    ADD CONSTRAINT board_members_pkey PRIMARY KEY (id);


--
-- Name: calendar_connections calendar_connections_organization_id_user_id_calendar_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_organization_id_user_id_calendar_id_key UNIQUE (organization_id, user_id, calendar_id);


--
-- Name: calendar_connections calendar_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_pkey PRIMARY KEY (id);


--
-- Name: calendar_events calendar_events_organization_id_google_event_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_organization_id_google_event_id_key UNIQUE (organization_id, google_event_id);


--
-- Name: calendar_events calendar_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_pkey PRIMARY KEY (id);


--
-- Name: campaign_sends campaign_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_sends
    ADD CONSTRAINT campaign_sends_pkey PRIMARY KEY (id);


--
-- Name: campaign_steps campaign_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_steps
    ADD CONSTRAINT campaign_steps_pkey PRIMARY KEY (id);


--
-- Name: community_foundation_registry community_foundation_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_foundation_registry
    ADD CONSTRAINT community_foundation_registry_pkey PRIMARY KEY (id);


--
-- Name: community_need_signals community_need_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_need_signals
    ADD CONSTRAINT community_need_signals_pkey PRIMARY KEY (id);


--
-- Name: competitor_tracking competitor_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_tracking
    ADD CONSTRAINT competitor_tracking_pkey PRIMARY KEY (id);


--
-- Name: compliance_events compliance_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_pkey PRIMARY KEY (id);


--
-- Name: contact_tasks contact_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tasks
    ADD CONSTRAINT contact_tasks_pkey PRIMARY KEY (id);


--
-- Name: contacts contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_pkey PRIMARY KEY (id);


--
-- Name: corporate_giving_targets corporate_giving_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_giving_targets
    ADD CONSTRAINT corporate_giving_targets_pkey PRIMARY KEY (id);


--
-- Name: corporate_intent_signals corporate_intent_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_intent_signals
    ADD CONSTRAINT corporate_intent_signals_pkey PRIMARY KEY (id);


--
-- Name: corporate_monitoring_events corporate_monitoring_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_monitoring_events
    ADD CONSTRAINT corporate_monitoring_events_pkey PRIMARY KEY (id);


--
-- Name: corporate_prospects corporate_prospects_name_city_state_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_prospects
    ADD CONSTRAINT corporate_prospects_name_city_state_unique UNIQUE (legal_name, address_city, address_state);


--
-- Name: corporate_prospects corporate_prospects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_prospects
    ADD CONSTRAINT corporate_prospects_pkey PRIMARY KEY (id);


--
-- Name: corporate_relationships corporate_relationships_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_relationships
    ADD CONSTRAINT corporate_relationships_pkey PRIMARY KEY (id);


--
-- Name: cross_client_submissions cross_client_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cross_client_submissions
    ADD CONSTRAINT cross_client_submissions_pkey PRIMARY KEY (id);


--
-- Name: custom_api_connections custom_api_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_api_connections
    ADD CONSTRAINT custom_api_connections_pkey PRIMARY KEY (id);


--
-- Name: custom_connector_allowlist custom_connector_allowlist_organization_id_domain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_connector_allowlist
    ADD CONSTRAINT custom_connector_allowlist_organization_id_domain_key UNIQUE (organization_id, domain);


--
-- Name: custom_connector_allowlist custom_connector_allowlist_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_connector_allowlist
    ADD CONSTRAINT custom_connector_allowlist_pkey PRIMARY KEY (id);


--
-- Name: dd_api_spend dd_api_spend_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dd_api_spend
    ADD CONSTRAINT dd_api_spend_pkey PRIMARY KEY (id);


--
-- Name: dd_api_spend dd_api_spend_provider_month_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dd_api_spend
    ADD CONSTRAINT dd_api_spend_provider_month_key UNIQUE (provider, month);


--
-- Name: dd_prospect_requests dd_prospect_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dd_prospect_requests
    ADD CONSTRAINT dd_prospect_requests_pkey PRIMARY KEY (id);


--
-- Name: dd_prospect_requests dd_prospect_requests_prospect_id_request_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dd_prospect_requests
    ADD CONSTRAINT dd_prospect_requests_prospect_id_request_id_key UNIQUE (prospect_id, request_id);


--
-- Name: dd_robots_cache dd_robots_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dd_robots_cache
    ADD CONSTRAINT dd_robots_cache_pkey PRIMARY KEY (domain);


--
-- Name: deadlines deadlines_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deadlines
    ADD CONSTRAINT deadlines_pkey PRIMARY KEY (id);


--
-- Name: disaster_declarations disaster_declarations_fema_disaster_number_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disaster_declarations
    ADD CONSTRAINT disaster_declarations_fema_disaster_number_key UNIQUE (fema_disaster_number);


--
-- Name: disaster_declarations disaster_declarations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disaster_declarations
    ADD CONSTRAINT disaster_declarations_pkey PRIMARY KEY (id);


--
-- Name: disaster_emergency_funds disaster_emergency_funds_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.disaster_emergency_funds
    ADD CONSTRAINT disaster_emergency_funds_pkey PRIMARY KEY (id);


--
-- Name: discovery_matches discovery_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovery_matches
    ADD CONSTRAINT discovery_matches_pkey PRIMARY KEY (id);


--
-- Name: discovery_runs discovery_runs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.discovery_runs
    ADD CONSTRAINT discovery_runs_pkey PRIMARY KEY (id);


--
-- Name: documents documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_pkey PRIMARY KEY (id);


--
-- Name: donor_discovery_connectors donor_discovery_connectors_organization_id_provider_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_connectors
    ADD CONSTRAINT donor_discovery_connectors_organization_id_provider_key UNIQUE (organization_id, provider);


--
-- Name: donor_discovery_connectors donor_discovery_connectors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_connectors
    ADD CONSTRAINT donor_discovery_connectors_pkey PRIMARY KEY (id);


--
-- Name: donor_discovery_directory donor_discovery_directory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_directory
    ADD CONSTRAINT donor_discovery_directory_pkey PRIMARY KEY (id);


--
-- Name: donor_discovery_geocache donor_discovery_geocache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_geocache
    ADD CONSTRAINT donor_discovery_geocache_pkey PRIMARY KEY (address_hash);


--
-- Name: donor_discovery_prospects donor_discovery_prospects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_prospects
    ADD CONSTRAINT donor_discovery_prospects_pkey PRIMARY KEY (id);


--
-- Name: donor_discovery_requests donor_discovery_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_requests
    ADD CONSTRAINT donor_discovery_requests_pkey PRIMARY KEY (id);


--
-- Name: donor_discovery_taxonomy_aliases donor_discovery_taxonomy_aliases_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_taxonomy_aliases
    ADD CONSTRAINT donor_discovery_taxonomy_aliases_pkey PRIMARY KEY (id);


--
-- Name: donor_discovery_taxonomy donor_discovery_taxonomy_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_taxonomy
    ADD CONSTRAINT donor_discovery_taxonomy_pkey PRIMARY KEY (id);


--
-- Name: donor_discovery_tos_registry donor_discovery_tos_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_tos_registry
    ADD CONSTRAINT donor_discovery_tos_registry_pkey PRIMARY KEY (domain);


--
-- Name: draft_automation_config draft_automation_config_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_automation_config
    ADD CONSTRAINT draft_automation_config_organization_id_key UNIQUE (organization_id);


--
-- Name: draft_automation_config draft_automation_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_automation_config
    ADD CONSTRAINT draft_automation_config_pkey PRIMARY KEY (id);


--
-- Name: draft_queue draft_queue_organization_id_opportunity_id_template_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_queue
    ADD CONSTRAINT draft_queue_organization_id_opportunity_id_template_type_key UNIQUE (organization_id, opportunity_id, template_type);


--
-- Name: draft_queue draft_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_queue
    ADD CONSTRAINT draft_queue_pkey PRIMARY KEY (id);


--
-- Name: draft_versions draft_versions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_versions
    ADD CONSTRAINT draft_versions_pkey PRIMARY KEY (id);


--
-- Name: email_activity email_activity_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_activity
    ADD CONSTRAINT email_activity_pkey PRIMARY KEY (id);


--
-- Name: email_campaign_sequences email_campaign_sequences_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_sequences
    ADD CONSTRAINT email_campaign_sequences_pkey PRIMARY KEY (id);


--
-- Name: email_campaigns email_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_pkey PRIMARY KEY (id);


--
-- Name: email_connections email_connections_organization_id_email_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_organization_id_email_address_key UNIQUE (organization_id, email_address);


--
-- Name: email_connections email_connections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_pkey PRIMARY KEY (id);


--
-- Name: email_sequence_enrollments email_sequence_enrollments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sequence_enrollments
    ADD CONSTRAINT email_sequence_enrollments_pkey PRIMARY KEY (id);


--
-- Name: email_sequence_enrollments email_sequence_enrollments_sequence_id_email_address_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sequence_enrollments
    ADD CONSTRAINT email_sequence_enrollments_sequence_id_email_address_key UNIQUE (sequence_id, email_address);


--
-- Name: email_sequence_steps email_sequence_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sequence_steps
    ADD CONSTRAINT email_sequence_steps_pkey PRIMARY KEY (id);


--
-- Name: email_templates email_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_pkey PRIMARY KEY (id);


--
-- Name: email_thread_links email_thread_links_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_thread_links
    ADD CONSTRAINT email_thread_links_pkey PRIMARY KEY (id);


--
-- Name: enrichment_jobs enrichment_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_jobs
    ADD CONSTRAINT enrichment_jobs_pkey PRIMARY KEY (id);


--
-- Name: enrichment_results enrichment_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_results
    ADD CONSTRAINT enrichment_results_pkey PRIMARY KEY (id);


--
-- Name: form_templates form_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_templates
    ADD CONSTRAINT form_templates_pkey PRIMARY KEY (id);


--
-- Name: foundation_directory foundation_directory_ein_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foundation_directory
    ADD CONSTRAINT foundation_directory_ein_unique UNIQUE (ein);


--
-- Name: foundation_directory foundation_directory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foundation_directory
    ADD CONSTRAINT foundation_directory_pkey PRIMARY KEY (id);


--
-- Name: foundation_profiles foundation_profiles_foundation_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foundation_profiles
    ADD CONSTRAINT foundation_profiles_foundation_id_key UNIQUE (foundation_id);


--
-- Name: foundation_profiles foundation_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foundation_profiles
    ADD CONSTRAINT foundation_profiles_pkey PRIMARY KEY (id);


--
-- Name: fundability_deficiencies fundability_deficiencies_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundability_deficiencies
    ADD CONSTRAINT fundability_deficiencies_pkey PRIMARY KEY (id);


--
-- Name: fundability_scores fundability_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundability_scores
    ADD CONSTRAINT fundability_scores_pkey PRIMARY KEY (id);


--
-- Name: funder_credentials funder_credentials_organization_id_funder_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_credentials
    ADD CONSTRAINT funder_credentials_organization_id_funder_id_key UNIQUE (organization_id, funder_id);


--
-- Name: funder_credentials funder_credentials_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_credentials
    ADD CONSTRAINT funder_credentials_pkey PRIMARY KEY (id);


--
-- Name: funder_dna_profiles funder_dna_profiles_organization_id_funder_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_dna_profiles
    ADD CONSTRAINT funder_dna_profiles_organization_id_funder_id_key UNIQUE (organization_id, funder_id);


--
-- Name: funder_dna_profiles funder_dna_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_dna_profiles
    ADD CONSTRAINT funder_dna_profiles_pkey PRIMARY KEY (id);


--
-- Name: funder_giving_history funder_giving_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_giving_history
    ADD CONSTRAINT funder_giving_history_pkey PRIMARY KEY (id);


--
-- Name: funder_intelligence funder_intelligence_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_intelligence
    ADD CONSTRAINT funder_intelligence_pkey PRIMARY KEY (id);


--
-- Name: funder_relationship_events funder_relationship_events_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_relationship_events
    ADD CONSTRAINT funder_relationship_events_pkey PRIMARY KEY (id);


--
-- Name: funder_relationship_scores funder_relationship_scores_org_funder_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_relationship_scores
    ADD CONSTRAINT funder_relationship_scores_org_funder_unique UNIQUE (organization_id, funder_id);


--
-- Name: funder_relationship_scores funder_relationship_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_relationship_scores
    ADD CONSTRAINT funder_relationship_scores_pkey PRIMARY KEY (id);


--
-- Name: funder_relationship_signals funder_relationship_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_relationship_signals
    ADD CONSTRAINT funder_relationship_signals_pkey PRIMARY KEY (id);


--
-- Name: funders funders_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funders
    ADD CONSTRAINT funders_pkey PRIMARY KEY (id);


--
-- Name: funding_forecasts funding_forecasts_org_date_period_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding_forecasts
    ADD CONSTRAINT funding_forecasts_org_date_period_unique UNIQUE (org_id, forecast_date, forecast_period);


--
-- Name: funding_forecasts funding_forecasts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funding_forecasts
    ADD CONSTRAINT funding_forecasts_pkey PRIMARY KEY (id);


--
-- Name: grant_agreements grant_agreements_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_agreements
    ADD CONSTRAINT grant_agreements_pkey PRIMARY KEY (id);


--
-- Name: grant_budgets grant_budgets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_budgets
    ADD CONSTRAINT grant_budgets_pkey PRIMARY KEY (id);


--
-- Name: grant_expenses grant_expenses_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_expenses
    ADD CONSTRAINT grant_expenses_pkey PRIMARY KEY (id);


--
-- Name: grant_reconciliation_reports grant_reconciliation_reports_organization_id_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_reconciliation_reports
    ADD CONSTRAINT grant_reconciliation_reports_organization_id_application_id_key UNIQUE (organization_id, application_id);


--
-- Name: grant_reconciliation_reports grant_reconciliation_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_reconciliation_reports
    ADD CONSTRAINT grant_reconciliation_reports_pkey PRIMARY KEY (id);


--
-- Name: historical_awards historical_awards_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_awards
    ADD CONSTRAINT historical_awards_pkey PRIMARY KEY (id);


--
-- Name: impact_simulations impact_simulations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impact_simulations
    ADD CONSTRAINT impact_simulations_pkey PRIMARY KEY (id);


--
-- Name: impersonation_log impersonation_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_log
    ADD CONSTRAINT impersonation_log_pkey PRIMARY KEY (id);


--
-- Name: improvement_proposals improvement_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.improvement_proposals
    ADD CONSTRAINT improvement_proposals_pkey PRIMARY KEY (id);


--
-- Name: integration_keys integration_keys_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_keys
    ADD CONSTRAINT integration_keys_pkey PRIMARY KEY (id);


--
-- Name: integrations integrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_pkey PRIMARY KEY (id);


--
-- Name: intelligence_budget_patterns intelligence_budget_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_budget_patterns
    ADD CONSTRAINT intelligence_budget_patterns_pkey PRIMARY KEY (id);


--
-- Name: intelligence_budget_templates intelligence_budget_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_budget_templates
    ADD CONSTRAINT intelligence_budget_templates_pkey PRIMARY KEY (id);


--
-- Name: intelligence_evaluation_frameworks intelligence_evaluation_frameworks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_evaluation_frameworks
    ADD CONSTRAINT intelligence_evaluation_frameworks_pkey PRIMARY KEY (id);


--
-- Name: intelligence_funded_proposals intelligence_funded_proposals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_funded_proposals
    ADD CONSTRAINT intelligence_funded_proposals_pkey PRIMARY KEY (id);


--
-- Name: intelligence_grant_dna_scores intelligence_grant_dna_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_grant_dna_scores
    ADD CONSTRAINT intelligence_grant_dna_scores_pkey PRIMARY KEY (id);


--
-- Name: intelligence_grantmaker_profiles intelligence_grantmaker_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_grantmaker_profiles
    ADD CONSTRAINT intelligence_grantmaker_profiles_pkey PRIMARY KEY (id);


--
-- Name: intelligence_logic_models intelligence_logic_models_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_logic_models
    ADD CONSTRAINT intelligence_logic_models_pkey PRIMARY KEY (id);


--
-- Name: intelligence_narrative_patterns intelligence_narrative_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_narrative_patterns
    ADD CONSTRAINT intelligence_narrative_patterns_pkey PRIMARY KEY (id);


--
-- Name: intelligence_need_data intelligence_need_data_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_need_data
    ADD CONSTRAINT intelligence_need_data_pkey PRIMARY KEY (id);


--
-- Name: intelligence_post_award_reports intelligence_post_award_reports_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_post_award_reports
    ADD CONSTRAINT intelligence_post_award_reports_pkey PRIMARY KEY (id);


--
-- Name: intelligence_proposal_sections intelligence_proposal_sections_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_proposal_sections
    ADD CONSTRAINT intelligence_proposal_sections_pkey PRIMARY KEY (id);


--
-- Name: intelligence_scoring_rubrics intelligence_scoring_rubrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_scoring_rubrics
    ADD CONSTRAINT intelligence_scoring_rubrics_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (id);


--
-- Name: invoices invoices_stripe_invoice_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_stripe_invoice_id_key UNIQUE (stripe_invoice_id);


--
-- Name: kb_extended_needs kb_extended_needs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_extended_needs
    ADD CONSTRAINT kb_extended_needs_pkey PRIMARY KEY (id);


--
-- Name: knowledge_base knowledge_base_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_base
    ADD CONSTRAINT knowledge_base_pkey PRIMARY KEY (id);


--
-- Name: knowledge_patterns knowledge_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_patterns
    ADD CONSTRAINT knowledge_patterns_pkey PRIMARY KEY (id);


--
-- Name: knowledge_queries knowledge_queries_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_queries
    ADD CONSTRAINT knowledge_queries_pkey PRIMARY KEY (id);


--
-- Name: marketplace_listings marketplace_listings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_listings
    ADD CONSTRAINT marketplace_listings_pkey PRIMARY KEY (id);


--
-- Name: marketplace_matches marketplace_matches_listing_id_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_matches
    ADD CONSTRAINT marketplace_matches_listing_id_organization_id_key UNIQUE (listing_id, organization_id);


--
-- Name: marketplace_matches marketplace_matches_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_matches
    ADD CONSTRAINT marketplace_matches_pkey PRIMARY KEY (id);


--
-- Name: nonprofits nonprofits_ein_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nonprofits
    ADD CONSTRAINT nonprofits_ein_key UNIQUE (ein);


--
-- Name: nonprofits nonprofits_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.nonprofits
    ADD CONSTRAINT nonprofits_pkey PRIMARY KEY (id);


--
-- Name: notes notes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_pkey PRIMARY KEY (id);


--
-- Name: onboarding_steps onboarding_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_pkey PRIMARY KEY (id);


--
-- Name: opportunities opportunities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_pkey PRIMARY KEY (id);


--
-- Name: opportunity_keywords opportunity_keywords_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_keywords
    ADD CONSTRAINT opportunity_keywords_pkey PRIMARY KEY (id);


--
-- Name: opportunity_probability_scores opportunity_probability_score_opportunity_id_organization_i_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_probability_scores
    ADD CONSTRAINT opportunity_probability_score_opportunity_id_organization_i_key UNIQUE (opportunity_id, organization_id);


--
-- Name: opportunity_probability_scores opportunity_probability_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_probability_scores
    ADD CONSTRAINT opportunity_probability_scores_pkey PRIMARY KEY (id);


--
-- Name: org_autonomous_config org_autonomous_config_org_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_autonomous_config
    ADD CONSTRAINT org_autonomous_config_org_id_key UNIQUE (org_id);


--
-- Name: org_autonomous_config org_autonomous_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_autonomous_config
    ADD CONSTRAINT org_autonomous_config_pkey PRIMARY KEY (id);


--
-- Name: org_documents org_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_documents
    ADD CONSTRAINT org_documents_pkey PRIMARY KEY (id);


--
-- Name: org_learning_contributions org_learning_contributions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_learning_contributions
    ADD CONSTRAINT org_learning_contributions_pkey PRIMARY KEY (id);


--
-- Name: org_settings org_settings_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_settings
    ADD CONSTRAINT org_settings_organization_id_key UNIQUE (organization_id);


--
-- Name: org_settings org_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_settings
    ADD CONSTRAINT org_settings_pkey PRIMARY KEY (id);


--
-- Name: org_usage_summary org_usage_summary_organization_id_period_date_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_usage_summary
    ADD CONSTRAINT org_usage_summary_organization_id_period_date_key UNIQUE (organization_id, period_date);


--
-- Name: org_usage_summary org_usage_summary_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_usage_summary
    ADD CONSTRAINT org_usage_summary_pkey PRIMARY KEY (id);


--
-- Name: organizational_digital_twins organizational_digital_twins_organization_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizational_digital_twins
    ADD CONSTRAINT organizational_digital_twins_organization_id_key UNIQUE (organization_id);


--
-- Name: organizational_digital_twins organizational_digital_twins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizational_digital_twins
    ADD CONSTRAINT organizational_digital_twins_pkey PRIMARY KEY (id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: outcomes outcomes_application_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcomes
    ADD CONSTRAINT outcomes_application_id_key UNIQUE (application_id);


--
-- Name: outcomes outcomes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcomes
    ADD CONSTRAINT outcomes_pkey PRIMARY KEY (id);


--
-- Name: outreach_contacts outreach_contacts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_contacts
    ADD CONSTRAINT outreach_contacts_pkey PRIMARY KEY (id);


--
-- Name: outreach_template_variants outreach_template_variants_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_template_variants
    ADD CONSTRAINT outreach_template_variants_pkey PRIMARY KEY (id);


--
-- Name: outreach_templates outreach_templates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_templates
    ADD CONSTRAINT outreach_templates_pkey PRIMARY KEY (id);


--
-- Name: pig_edges pig_edges_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pig_edges
    ADD CONSTRAINT pig_edges_pkey PRIMARY KEY (id);


--
-- Name: pig_edges pig_edges_source_node_id_target_node_id_relationship_type_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pig_edges
    ADD CONSTRAINT pig_edges_source_node_id_target_node_id_relationship_type_key UNIQUE (source_node_id, target_node_id, relationship_type);


--
-- Name: pig_nodes pig_nodes_entity_table_entity_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pig_nodes
    ADD CONSTRAINT pig_nodes_entity_table_entity_id_key UNIQUE (entity_table, entity_id);


--
-- Name: pig_nodes pig_nodes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pig_nodes
    ADD CONSTRAINT pig_nodes_pkey PRIMARY KEY (id);


--
-- Name: pipeline_history pipeline_history_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_history
    ADD CONSTRAINT pipeline_history_pkey PRIMARY KEY (id);


--
-- Name: pitch_cache pitch_cache_organization_id_funder_id_request_profile_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pitch_cache
    ADD CONSTRAINT pitch_cache_organization_id_funder_id_request_profile_id_key UNIQUE (organization_id, funder_id, request_profile_id);


--
-- Name: pitch_cache pitch_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pitch_cache
    ADD CONSTRAINT pitch_cache_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_pkey PRIMARY KEY (id);


--
-- Name: platform_admins platform_admins_user_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_user_id_key UNIQUE (user_id);


--
-- Name: platform_config platform_config_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_pkey PRIMARY KEY (id);


--
-- Name: platform_learning_patterns platform_learning_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_learning_patterns
    ADD CONSTRAINT platform_learning_patterns_pkey PRIMARY KEY (id);


--
-- Name: platform_tasks platform_tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_tasks
    ADD CONSTRAINT platform_tasks_pkey PRIMARY KEY (id);


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_pkey PRIMARY KEY (id);


--
-- Name: programs programs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programs
    ADD CONSTRAINT programs_pkey PRIMARY KEY (id);


--
-- Name: prospect_lists prospect_lists_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospect_lists
    ADD CONSTRAINT prospect_lists_pkey PRIMARY KEY (id);


--
-- Name: prospects prospects_list_id_ein_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_list_id_ein_key UNIQUE (list_id, ein);


--
-- Name: prospects prospects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_pkey PRIMARY KEY (id);


--
-- Name: proven_narratives proven_narratives_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proven_narratives
    ADD CONSTRAINT proven_narratives_pkey PRIMARY KEY (id);


--
-- Name: relationship_memory relationship_memory_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationship_memory
    ADD CONSTRAINT relationship_memory_pkey PRIMARY KEY (id);


--
-- Name: relationship_recommendations relationship_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationship_recommendations
    ADD CONSTRAINT relationship_recommendations_pkey PRIMARY KEY (id);


--
-- Name: renewals renewals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renewals
    ADD CONSTRAINT renewals_pkey PRIMARY KEY (id);


--
-- Name: reputation_alerts reputation_alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reputation_alerts
    ADD CONSTRAINT reputation_alerts_pkey PRIMARY KEY (id);


--
-- Name: reputation_signals reputation_signals_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reputation_signals
    ADD CONSTRAINT reputation_signals_pkey PRIMARY KEY (id);


--
-- Name: request_profiles request_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_profiles
    ADD CONSTRAINT request_profiles_pkey PRIMARY KEY (id);


--
-- Name: research_cache research_cache_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_cache
    ADD CONSTRAINT research_cache_pkey PRIMARY KEY (id);


--
-- Name: roi_insights roi_insights_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roi_insights
    ADD CONSTRAINT roi_insights_pkey PRIMARY KEY (id);


--
-- Name: sales_campaign_steps sales_campaign_steps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_campaign_steps
    ADD CONSTRAINT sales_campaign_steps_pkey PRIMARY KEY (id);


--
-- Name: sales_campaigns sales_campaigns_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_campaigns
    ADD CONSTRAINT sales_campaigns_pkey PRIMARY KEY (id);


--
-- Name: sales_sends sales_sends_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_sends
    ADD CONSTRAINT sales_sends_pkey PRIMARY KEY (id);


--
-- Name: scrape_jobs scrape_jobs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scrape_jobs
    ADD CONSTRAINT scrape_jobs_pkey PRIMARY KEY (id);


--
-- Name: scrape_results scrape_results_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scrape_results
    ADD CONSTRAINT scrape_results_pkey PRIMARY KEY (id);


--
-- Name: scraping_targets scraping_targets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scraping_targets
    ADD CONSTRAINT scraping_targets_pkey PRIMARY KEY (id);


--
-- Name: search_profiles search_profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_profiles
    ADD CONSTRAINT search_profiles_pkey PRIMARY KEY (id);


--
-- Name: sending_domains sending_domains_domain_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sending_domains
    ADD CONSTRAINT sending_domains_domain_key UNIQUE (domain);


--
-- Name: sending_domains sending_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sending_domains
    ADD CONSTRAINT sending_domains_pkey PRIMARY KEY (id);


--
-- Name: simulation_scenarios simulation_scenarios_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_scenarios
    ADD CONSTRAINT simulation_scenarios_pkey PRIMARY KEY (id);


--
-- Name: solicitation_registrations solicitation_registrations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitation_registrations
    ADD CONSTRAINT solicitation_registrations_pkey PRIMARY KEY (id);


--
-- Name: strategic_recommendations strategic_recommendations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategic_recommendations
    ADD CONSTRAINT strategic_recommendations_pkey PRIMARY KEY (id);


--
-- Name: submission_queue submission_queue_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_queue
    ADD CONSTRAINT submission_queue_pkey PRIMARY KEY (id);


--
-- Name: submission_receipts submission_receipts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_receipts
    ADD CONSTRAINT submission_receipts_pkey PRIMARY KEY (id);


--
-- Name: submission_variables submission_variables_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_variables
    ADD CONSTRAINT submission_variables_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_pkey PRIMARY KEY (id);


--
-- Name: subscriptions subscriptions_stripe_subscription_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_stripe_subscription_id_key UNIQUE (stripe_subscription_id);


--
-- Name: success_probability_scores success_probability_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.success_probability_scores
    ADD CONSTRAINT success_probability_scores_pkey PRIMARY KEY (id);


--
-- Name: suppression_list suppression_list_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppression_list
    ADD CONSTRAINT suppression_list_email_key UNIQUE (email);


--
-- Name: suppression_list suppression_list_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.suppression_list
    ADD CONSTRAINT suppression_list_pkey PRIMARY KEY (id);


--
-- Name: synced_email_messages synced_email_messages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_email_messages
    ADD CONSTRAINT synced_email_messages_pkey PRIMARY KEY (id);


--
-- Name: synced_email_threads synced_email_threads_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_email_threads
    ADD CONSTRAINT synced_email_threads_pkey PRIMARY KEY (id);


--
-- Name: system_errors system_errors_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_errors
    ADD CONSTRAINT system_errors_pkey PRIMARY KEY (id);


--
-- Name: team_activity_log team_activity_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_activity_log
    ADD CONSTRAINT team_activity_log_pkey PRIMARY KEY (id);


--
-- Name: application_documents uq_application_documents; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_documents
    ADD CONSTRAINT uq_application_documents UNIQUE (application_id, document_id);


--
-- Name: platform_config uq_platform_config_org_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT uq_platform_config_org_key UNIQUE (organization_id, key);


--
-- Name: usage_metrics usage_metrics_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_metrics
    ADD CONSTRAINT usage_metrics_pkey PRIMARY KEY (id);


--
-- Name: usage_tracking usage_tracking_org_resource_period; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT usage_tracking_org_resource_period UNIQUE (organization_id, resource_type, period_start);


--
-- Name: usage_tracking usage_tracking_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT usage_tracking_pkey PRIMARY KEY (id);


--
-- Name: user_invitations user_invitations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invitations
    ADD CONSTRAINT user_invitations_pkey PRIMARY KEY (id);


--
-- Name: validations validations_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validations
    ADD CONSTRAINT validations_pkey PRIMARY KEY (id);


--
-- Name: webhook_configs webhook_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_configs
    ADD CONSTRAINT webhook_configs_pkey PRIMARY KEY (id);


--
-- Name: worker_status worker_status_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_status
    ADD CONSTRAINT worker_status_pkey PRIMARY KEY (id);


--
-- Name: worker_status worker_status_worker_id_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_status
    ADD CONSTRAINT worker_status_worker_id_key UNIQUE (worker_id);


--
-- Name: messages messages_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_18 messages_2026_08_18_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_18
    ADD CONSTRAINT messages_2026_08_18_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_19 messages_2026_08_19_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_19
    ADD CONSTRAINT messages_2026_08_19_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_20 messages_2026_08_20_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_20
    ADD CONSTRAINT messages_2026_08_20_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_21 messages_2026_08_21_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_21
    ADD CONSTRAINT messages_2026_08_21_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_22 messages_2026_08_22_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_22
    ADD CONSTRAINT messages_2026_08_22_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_23 messages_2026_08_23_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_23
    ADD CONSTRAINT messages_2026_08_23_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages_2026_08_24 messages_2026_08_24_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.messages_2026_08_24
    ADD CONSTRAINT messages_2026_08_24_pkey PRIMARY KEY (id, inserted_at);


--
-- Name: messages messages_payload_exclusive; Type: CHECK CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE realtime.messages
    ADD CONSTRAINT messages_payload_exclusive CHECK (((payload IS NULL) OR (binary_payload IS NULL))) NOT VALID;


--
-- Name: subscription pk_subscription; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.subscription
    ADD CONSTRAINT pk_subscription PRIMARY KEY (id);


--
-- Name: schema_migrations schema_migrations_pkey; Type: CONSTRAINT; Schema: realtime; Owner: -
--

ALTER TABLE ONLY realtime.schema_migrations
    ADD CONSTRAINT schema_migrations_pkey PRIMARY KEY (version);


--
-- Name: buckets_analytics buckets_analytics_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_analytics
    ADD CONSTRAINT buckets_analytics_pkey PRIMARY KEY (id);


--
-- Name: buckets buckets_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets
    ADD CONSTRAINT buckets_pkey PRIMARY KEY (id);


--
-- Name: buckets_vectors buckets_vectors_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.buckets_vectors
    ADD CONSTRAINT buckets_vectors_pkey PRIMARY KEY (id);


--
-- Name: migrations migrations_name_key; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_name_key UNIQUE (name);


--
-- Name: migrations migrations_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.migrations
    ADD CONSTRAINT migrations_pkey PRIMARY KEY (id);


--
-- Name: objects objects_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT objects_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_pkey PRIMARY KEY (id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_pkey PRIMARY KEY (id);


--
-- Name: vector_indexes vector_indexes_pkey; Type: CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_pkey PRIMARY KEY (id);


--
-- Name: audit_logs_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX audit_logs_instance_id_idx ON auth.audit_log_entries USING btree (instance_id);


--
-- Name: confirmation_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX confirmation_token_idx ON auth.users USING btree (confirmation_token) WHERE ((confirmation_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: custom_oauth_providers_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_created_at_idx ON auth.custom_oauth_providers USING btree (created_at);


--
-- Name: custom_oauth_providers_enabled_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_enabled_idx ON auth.custom_oauth_providers USING btree (enabled);


--
-- Name: custom_oauth_providers_identifier_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_identifier_idx ON auth.custom_oauth_providers USING btree (identifier);


--
-- Name: custom_oauth_providers_provider_type_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX custom_oauth_providers_provider_type_idx ON auth.custom_oauth_providers USING btree (provider_type);


--
-- Name: email_change_token_current_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_current_idx ON auth.users USING btree (email_change_token_current) WHERE ((email_change_token_current)::text !~ '^[0-9 ]*$'::text);


--
-- Name: email_change_token_new_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX email_change_token_new_idx ON auth.users USING btree (email_change_token_new) WHERE ((email_change_token_new)::text !~ '^[0-9 ]*$'::text);


--
-- Name: factor_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX factor_id_created_at_idx ON auth.mfa_factors USING btree (user_id, created_at);


--
-- Name: flow_state_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX flow_state_created_at_idx ON auth.flow_state USING btree (created_at DESC);


--
-- Name: identities_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_email_idx ON auth.identities USING btree (email text_pattern_ops);


--
-- Name: INDEX identities_email_idx; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.identities_email_idx IS 'Auth: Ensures indexed queries on the email column';


--
-- Name: identities_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX identities_user_id_idx ON auth.identities USING btree (user_id);


--
-- Name: idx_auth_code; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_auth_code ON auth.flow_state USING btree (auth_code);


--
-- Name: idx_oauth_client_states_created_at; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_oauth_client_states_created_at ON auth.oauth_client_states USING btree (created_at);


--
-- Name: idx_user_id_auth_method; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_user_id_auth_method ON auth.flow_state USING btree (user_id, authentication_method);


--
-- Name: idx_users_created_at_desc; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_created_at_desc ON auth.users USING btree (created_at DESC);


--
-- Name: idx_users_email; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_email ON auth.users USING btree (email);


--
-- Name: idx_users_last_sign_in_at_desc; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_last_sign_in_at_desc ON auth.users USING btree (last_sign_in_at DESC);


--
-- Name: idx_users_name; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX idx_users_name ON auth.users USING btree (((raw_user_meta_data ->> 'name'::text))) WHERE ((raw_user_meta_data ->> 'name'::text) IS NOT NULL);


--
-- Name: mfa_challenge_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_challenge_created_at_idx ON auth.mfa_challenges USING btree (created_at DESC);


--
-- Name: mfa_factors_user_friendly_name_unique; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX mfa_factors_user_friendly_name_unique ON auth.mfa_factors USING btree (friendly_name, user_id) WHERE (TRIM(BOTH FROM friendly_name) <> ''::text);


--
-- Name: mfa_factors_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX mfa_factors_user_id_idx ON auth.mfa_factors USING btree (user_id);


--
-- Name: oauth_auth_pending_exp_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_auth_pending_exp_idx ON auth.oauth_authorizations USING btree (expires_at) WHERE (status = 'pending'::auth.oauth_authorization_status);


--
-- Name: oauth_clients_deleted_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_clients_deleted_at_idx ON auth.oauth_clients USING btree (deleted_at);


--
-- Name: oauth_consents_active_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_client_idx ON auth.oauth_consents USING btree (client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_active_user_client_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_active_user_client_idx ON auth.oauth_consents USING btree (user_id, client_id) WHERE (revoked_at IS NULL);


--
-- Name: oauth_consents_user_order_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX oauth_consents_user_order_idx ON auth.oauth_consents USING btree (user_id, granted_at DESC);


--
-- Name: one_time_tokens_relates_to_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_relates_to_hash_idx ON auth.one_time_tokens USING hash (relates_to);


--
-- Name: one_time_tokens_token_hash_hash_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX one_time_tokens_token_hash_hash_idx ON auth.one_time_tokens USING hash (token_hash);


--
-- Name: one_time_tokens_user_id_token_type_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX one_time_tokens_user_id_token_type_key ON auth.one_time_tokens USING btree (user_id, token_type);


--
-- Name: reauthentication_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX reauthentication_token_idx ON auth.users USING btree (reauthentication_token) WHERE ((reauthentication_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: recovery_token_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX recovery_token_idx ON auth.users USING btree (recovery_token) WHERE ((recovery_token)::text !~ '^[0-9 ]*$'::text);


--
-- Name: refresh_tokens_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_idx ON auth.refresh_tokens USING btree (instance_id);


--
-- Name: refresh_tokens_instance_id_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_instance_id_user_id_idx ON auth.refresh_tokens USING btree (instance_id, user_id);


--
-- Name: refresh_tokens_parent_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_parent_idx ON auth.refresh_tokens USING btree (parent);


--
-- Name: refresh_tokens_session_id_revoked_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_session_id_revoked_idx ON auth.refresh_tokens USING btree (session_id, revoked);


--
-- Name: refresh_tokens_updated_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX refresh_tokens_updated_at_idx ON auth.refresh_tokens USING btree (updated_at DESC);


--
-- Name: saml_providers_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_providers_sso_provider_id_idx ON auth.saml_providers USING btree (sso_provider_id);


--
-- Name: saml_relay_states_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_created_at_idx ON auth.saml_relay_states USING btree (created_at DESC);


--
-- Name: saml_relay_states_for_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_for_email_idx ON auth.saml_relay_states USING btree (for_email);


--
-- Name: saml_relay_states_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX saml_relay_states_sso_provider_id_idx ON auth.saml_relay_states USING btree (sso_provider_id);


--
-- Name: sessions_not_after_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_not_after_idx ON auth.sessions USING btree (not_after DESC);


--
-- Name: sessions_oauth_client_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_oauth_client_id_idx ON auth.sessions USING btree (oauth_client_id);


--
-- Name: sessions_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sessions_user_id_idx ON auth.sessions USING btree (user_id);


--
-- Name: sso_domains_domain_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_domains_domain_idx ON auth.sso_domains USING btree (lower(domain));


--
-- Name: sso_domains_sso_provider_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_domains_sso_provider_id_idx ON auth.sso_domains USING btree (sso_provider_id);


--
-- Name: sso_providers_resource_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX sso_providers_resource_id_idx ON auth.sso_providers USING btree (lower(resource_id));


--
-- Name: sso_providers_resource_id_pattern_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX sso_providers_resource_id_pattern_idx ON auth.sso_providers USING btree (resource_id text_pattern_ops);


--
-- Name: unique_phone_factor_per_user; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX unique_phone_factor_per_user ON auth.mfa_factors USING btree (user_id, phone);


--
-- Name: user_id_created_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX user_id_created_at_idx ON auth.sessions USING btree (user_id, created_at);


--
-- Name: users_email_partial_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX users_email_partial_key ON auth.users USING btree (email) WHERE (is_sso_user = false);


--
-- Name: INDEX users_email_partial_key; Type: COMMENT; Schema: auth; Owner: -
--

COMMENT ON INDEX auth.users_email_partial_key IS 'Auth: A partial unique index that applies only when is_sso_user is false';


--
-- Name: users_instance_id_email_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_email_idx ON auth.users USING btree (instance_id, lower((email)::text));


--
-- Name: users_instance_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_instance_id_idx ON auth.users USING btree (instance_id);


--
-- Name: users_is_anonymous_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX users_is_anonymous_idx ON auth.users USING btree (is_anonymous);


--
-- Name: webauthn_challenges_expires_at_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_expires_at_idx ON auth.webauthn_challenges USING btree (expires_at);


--
-- Name: webauthn_challenges_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_challenges_user_id_idx ON auth.webauthn_challenges USING btree (user_id);


--
-- Name: webauthn_credentials_credential_id_key; Type: INDEX; Schema: auth; Owner: -
--

CREATE UNIQUE INDEX webauthn_credentials_credential_id_key ON auth.webauthn_credentials USING btree (credential_id);


--
-- Name: webauthn_credentials_user_id_idx; Type: INDEX; Schema: auth; Owner: -
--

CREATE INDEX webauthn_credentials_user_id_idx ON auth.webauthn_credentials USING btree (user_id);


--
-- Name: autoapply_follow_ups_funder_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX autoapply_follow_ups_funder_id_idx ON public.autoapply_follow_ups USING btree (funder_id);


--
-- Name: autoapply_follow_ups_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX autoapply_follow_ups_organization_id_idx ON public.autoapply_follow_ups USING btree (organization_id);


--
-- Name: autoapply_follow_ups_status_scheduled_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX autoapply_follow_ups_status_scheduled_at_idx ON public.autoapply_follow_ups USING btree (status, scheduled_at);


--
-- Name: autoapply_follow_ups_submission_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX autoapply_follow_ups_submission_id_idx ON public.autoapply_follow_ups USING btree (submission_id);


--
-- Name: contact_tasks_contact_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_tasks_contact_id_idx ON public.contact_tasks USING btree (contact_id);


--
-- Name: contact_tasks_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_tasks_organization_id_idx ON public.contact_tasks USING btree (organization_id);


--
-- Name: contact_tasks_status_due_at_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX contact_tasks_status_due_at_idx ON public.contact_tasks USING btree (status, due_at);


--
-- Name: dd_prospect_requests_prospect_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dd_prospect_requests_prospect_id_idx ON public.dd_prospect_requests USING btree (prospect_id);


--
-- Name: dd_prospect_requests_request_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX dd_prospect_requests_request_id_idx ON public.dd_prospect_requests USING btree (request_id);


--
-- Name: donor_discovery_connectors_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donor_discovery_connectors_organization_id_idx ON public.donor_discovery_connectors USING btree (organization_id);


--
-- Name: donor_discovery_directory_dedup_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX donor_discovery_directory_dedup_idx ON public.donor_discovery_directory USING btree (lower(legal_name), public.donor_discovery_extract_domain(website));


--
-- Name: donor_discovery_directory_geo_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donor_discovery_directory_geo_idx ON public.donor_discovery_directory USING gist (geo);


--
-- Name: donor_discovery_directory_linked_foundation_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donor_discovery_directory_linked_foundation_id_idx ON public.donor_discovery_directory USING btree (linked_foundation_id);


--
-- Name: donor_discovery_prospects_directory_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donor_discovery_prospects_directory_id_idx ON public.donor_discovery_prospects USING btree (directory_id);


--
-- Name: donor_discovery_prospects_org_directory_uidx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX donor_discovery_prospects_org_directory_uidx ON public.donor_discovery_prospects USING btree (organization_id, directory_id);


--
-- Name: donor_discovery_prospects_organization_id_pipeline_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donor_discovery_prospects_organization_id_pipeline_stage_idx ON public.donor_discovery_prospects USING btree (organization_id, pipeline_stage);


--
-- Name: donor_discovery_prospects_request_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donor_discovery_prospects_request_id_idx ON public.donor_discovery_prospects USING btree (request_id);


--
-- Name: donor_discovery_prospects_score_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donor_discovery_prospects_score_idx ON public.donor_discovery_prospects USING btree (score DESC);


--
-- Name: donor_discovery_requests_organization_id_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donor_discovery_requests_organization_id_status_idx ON public.donor_discovery_requests USING btree (organization_id, status);


--
-- Name: donor_discovery_taxonomy_kind_code_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX donor_discovery_taxonomy_kind_code_idx ON public.donor_discovery_taxonomy USING btree (kind, code);


--
-- Name: donor_discovery_taxonomy_parent_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX donor_discovery_taxonomy_parent_id_idx ON public.donor_discovery_taxonomy USING btree (parent_id);


--
-- Name: idx_adapter_usage_log_org_adapter_called_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_adapter_usage_log_org_adapter_called_at ON public.adapter_usage_log USING btree (organization_id, adapter_name, called_at DESC);


--
-- Name: idx_agent_config_agent; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_config_agent ON public.agent_configurations USING btree (agent_id);


--
-- Name: idx_agent_config_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_config_org ON public.agent_configurations USING btree (organization_id);


--
-- Name: idx_agent_runs_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_org ON public.agent_runs USING btree (organization_id);


--
-- Name: idx_agent_runs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_status ON public.agent_runs USING btree (status);


--
-- Name: idx_agent_runs_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_agent_runs_type ON public.agent_runs USING btree (agent_type);


--
-- Name: idx_ai_usage_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_date ON public.ai_usage_log USING btree (created_at);


--
-- Name: idx_ai_usage_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_ai_usage_org ON public.ai_usage_log USING btree (organization_id);


--
-- Name: idx_alerts_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_active ON public.alerts USING btree (organization_id, is_dismissed, snoozed_until);


--
-- Name: idx_alerts_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_org ON public.alerts USING btree (organization_id);


--
-- Name: idx_alerts_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_alerts_type ON public.alerts USING btree (type);


--
-- Name: idx_applications_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_assigned ON public.applications USING btree (assigned_user_id);


--
-- Name: idx_applications_opp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_opp ON public.applications USING btree (opportunity_id);


--
-- Name: idx_applications_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_org ON public.applications USING btree (organization_id);


--
-- Name: idx_applications_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_applications_stage ON public.applications USING btree (stage);


--
-- Name: idx_audit_logs_action; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_action ON public.audit_logs USING btree (action);


--
-- Name: idx_audit_logs_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_date ON public.audit_logs USING btree (created_at);


--
-- Name: idx_audit_logs_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_org ON public.audit_logs USING btree (organization_id);


--
-- Name: idx_audit_logs_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user ON public.audit_logs USING btree (user_id);


--
-- Name: idx_auto_notif_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_notif_org ON public.automation_notifications USING btree (organization_id);


--
-- Name: idx_auto_screenshots_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_screenshots_session ON public.automation_screenshots USING btree (session_id);


--
-- Name: idx_auto_sessions_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_sessions_app ON public.automation_sessions USING btree (application_id);


--
-- Name: idx_auto_sessions_approval; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_sessions_approval ON public.automation_sessions USING btree (organization_id, approval_required_at) WHERE (approval_required_at IS NOT NULL);


--
-- Name: idx_auto_sessions_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_sessions_org ON public.automation_sessions USING btree (organization_id);


--
-- Name: idx_auto_sessions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_sessions_status ON public.automation_sessions USING btree (status);


--
-- Name: idx_auto_sessions_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_sessions_type ON public.automation_sessions USING btree (organization_id, session_type);


--
-- Name: idx_auto_steps_session; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_auto_steps_session ON public.automation_steps USING btree (session_id);


--
-- Name: idx_autoapply_confirmation_ambiguous_matches_message_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autoapply_confirmation_ambiguous_matches_message_id ON public.autoapply_confirmation_ambiguous_matches USING btree (gmail_message_id);


--
-- Name: idx_autoapply_confirmation_ambiguous_matches_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autoapply_confirmation_ambiguous_matches_status ON public.autoapply_confirmation_ambiguous_matches USING btree (status, received_at);


--
-- Name: idx_autoapply_confirmation_processed_messages_processed_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autoapply_confirmation_processed_messages_processed_at ON public.autoapply_confirmation_processed_messages USING btree (processed_at);


--
-- Name: idx_autoapply_submissions_confirmation_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autoapply_submissions_confirmation_pending ON public.autoapply_submissions USING btree (submitted_at) WHERE (confirmation_email_received = false);


--
-- Name: idx_autoapply_submissions_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autoapply_submissions_domain ON public.autoapply_submissions USING btree (funder_id, submitted_at DESC);


--
-- Name: idx_autoapply_submissions_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autoapply_submissions_funder ON public.autoapply_submissions USING btree (funder_id);


--
-- Name: idx_autoapply_submissions_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autoapply_submissions_org ON public.autoapply_submissions USING btree (organization_id);


--
-- Name: idx_autoapply_submissions_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_autoapply_submissions_status ON public.autoapply_submissions USING btree (status);


--
-- Name: idx_automation_notifications_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_notifications_org ON public.automation_notifications USING btree (organization_id);


--
-- Name: idx_automation_notifications_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_notifications_read ON public.automation_notifications USING btree (organization_id, is_read);


--
-- Name: idx_automation_queue_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_queue_org ON public.automation_queue USING btree (organization_id);


--
-- Name: idx_automation_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_automation_queue_status ON public.automation_queue USING btree (status);


--
-- Name: idx_board_meetings_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_board_meetings_org ON public.board_meetings USING btree (org_id, meeting_date);


--
-- Name: idx_board_packets_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_board_packets_org ON public.board_meeting_packets USING btree (org_id);


--
-- Name: idx_budget_patterns_category_type; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_budget_patterns_category_type ON public.intelligence_budget_patterns USING btree (program_category, grant_type);


--
-- Name: idx_cal_events_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cal_events_org ON public.calendar_events USING btree (organization_id);


--
-- Name: idx_cal_events_start; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cal_events_start ON public.calendar_events USING btree (start_time);


--
-- Name: idx_comm_foundation_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_comm_foundation_state ON public.community_foundation_registry USING btree (state);


--
-- Name: idx_competitor_observed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_observed ON public.competitor_tracking USING btree (observed_at DESC);


--
-- Name: idx_competitor_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_opportunity ON public.competitor_tracking USING btree (opportunity_id);


--
-- Name: idx_competitor_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_competitor_org ON public.competitor_tracking USING btree (organization_id);


--
-- Name: idx_compliance_events_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_events_application ON public.compliance_events USING btree (application_id);


--
-- Name: idx_compliance_events_org_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_compliance_events_org_due ON public.compliance_events USING btree (organization_id, due_date);


--
-- Name: idx_contacts_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_funder ON public.contacts USING btree (funder_id);


--
-- Name: idx_contacts_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_contacts_org ON public.contacts USING btree (organization_id);


--
-- Name: idx_corp_giving_active; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corp_giving_active ON public.corporate_giving_targets USING btree (is_active);


--
-- Name: idx_corporate_prospects_ein; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corporate_prospects_ein ON public.corporate_prospects USING btree (ein);


--
-- Name: idx_corporate_prospects_enrichment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corporate_prospects_enrichment ON public.corporate_prospects USING gin (enrichment);


--
-- Name: idx_corporate_prospects_naics; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corporate_prospects_naics ON public.corporate_prospects USING btree (naics_code);


--
-- Name: idx_corporate_prospects_scores; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corporate_prospects_scores ON public.corporate_prospects USING gin (scores);


--
-- Name: idx_corporate_prospects_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_corporate_prospects_state ON public.corporate_prospects USING btree (address_state);


--
-- Name: idx_cross_client_domain; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_cross_client_domain ON public.cross_client_submissions USING btree (funder_domain, submitted_at DESC);


--
-- Name: idx_custom_api_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_api_org ON public.custom_api_connections USING btree (organization_id);


--
-- Name: idx_custom_connector_allowlist_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_custom_connector_allowlist_org ON public.custom_connector_allowlist USING btree (organization_id);


--
-- Name: idx_dd_taxonomy_aliases_alias_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dd_taxonomy_aliases_alias_trgm ON public.donor_discovery_taxonomy_aliases USING gin (alias public.gin_trgm_ops);


--
-- Name: idx_dd_taxonomy_aliases_taxonomy_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_dd_taxonomy_aliases_taxonomy_id ON public.donor_discovery_taxonomy_aliases USING btree (taxonomy_id);


--
-- Name: idx_deadlines_completed; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deadlines_completed ON public.deadlines USING btree (is_completed);


--
-- Name: idx_deadlines_due; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deadlines_due ON public.deadlines USING btree (due_date);


--
-- Name: idx_deadlines_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_deadlines_org ON public.deadlines USING btree (organization_id);


--
-- Name: idx_digital_twins_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_digital_twins_org ON public.organizational_digital_twins USING btree (organization_id);


--
-- Name: idx_disaster_decl_states; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_disaster_decl_states ON public.disaster_declarations USING gin (affected_states);


--
-- Name: idx_documents_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_category ON public.documents USING btree (category);


--
-- Name: idx_documents_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_documents_org ON public.documents USING btree (organization_id);


--
-- Name: idx_draft_queue_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_queue_org ON public.draft_queue USING btree (organization_id);


--
-- Name: idx_draft_queue_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_queue_priority ON public.draft_queue USING btree (priority, deadline_date);


--
-- Name: idx_draft_queue_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_queue_scheduled ON public.draft_queue USING btree (scheduled_for) WHERE (status = 'pending'::public.draft_queue_status);


--
-- Name: idx_draft_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_queue_status ON public.draft_queue USING btree (status);


--
-- Name: idx_draft_versions_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_versions_app ON public.draft_versions USING btree (application_id);


--
-- Name: idx_draft_versions_opp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_versions_opp ON public.draft_versions USING btree (opportunity_id);


--
-- Name: idx_draft_versions_opp_created; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_versions_opp_created ON public.draft_versions USING btree (opportunity_id, created_at DESC);


--
-- Name: idx_draft_versions_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_draft_versions_org ON public.draft_versions USING btree (organization_id);


--
-- Name: idx_email_activity_email_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_activity_email_type ON public.email_activity USING btree (email_type);


--
-- Name: idx_email_activity_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_activity_funder ON public.email_activity USING btree (funder_id);


--
-- Name: idx_email_activity_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_activity_org ON public.email_activity USING btree (organization_id);


--
-- Name: idx_email_enrollments_next; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_enrollments_next ON public.email_sequence_enrollments USING btree (next_send_at) WHERE (status = 'active'::text);


--
-- Name: idx_email_links_contact; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_links_contact ON public.email_thread_links USING btree (contact_id);


--
-- Name: idx_email_links_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_links_funder ON public.email_thread_links USING btree (funder_id);


--
-- Name: idx_email_links_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_links_thread ON public.email_thread_links USING btree (thread_id);


--
-- Name: idx_email_messages_gmail; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_messages_gmail ON public.synced_email_messages USING btree (organization_id, gmail_message_id);


--
-- Name: idx_email_messages_thread; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_messages_thread ON public.synced_email_messages USING btree (thread_id);


--
-- Name: idx_email_threads_gmail; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_email_threads_gmail ON public.synced_email_threads USING btree (organization_id, gmail_thread_id);


--
-- Name: idx_email_threads_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_email_threads_org ON public.synced_email_threads USING btree (organization_id);


--
-- Name: idx_enrichment_jobs_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrichment_jobs_org ON public.enrichment_jobs USING btree (organization_id);


--
-- Name: idx_enrichment_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrichment_jobs_status ON public.enrichment_jobs USING btree (status);


--
-- Name: idx_enrichment_results_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrichment_results_entity ON public.enrichment_results USING btree (entity_ein);


--
-- Name: idx_enrichment_results_job; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_enrichment_results_job ON public.enrichment_results USING btree (job_id);


--
-- Name: idx_forecasts_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_forecasts_org ON public.funding_forecasts USING btree (org_id, forecast_date);


--
-- Name: idx_form_templates_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_templates_funder ON public.form_templates USING btree (funder_id);


--
-- Name: idx_form_templates_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_form_templates_org ON public.form_templates USING btree (organization_id);


--
-- Name: idx_foundation_directory_name_fts; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_foundation_directory_name_fts ON public.foundation_directory USING gin (to_tsvector('english'::regconfig, name));


--
-- Name: idx_foundation_directory_name_trgm; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_foundation_directory_name_trgm ON public.foundation_directory USING gin (name public.gin_trgm_ops);


--
-- Name: idx_foundation_directory_ntee_code; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_foundation_directory_ntee_code ON public.foundation_directory USING btree (ntee_code);


--
-- Name: idx_foundation_directory_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_foundation_directory_state ON public.foundation_directory USING btree (state);


--
-- Name: idx_foundation_directory_subsection; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_foundation_directory_subsection ON public.foundation_directory USING btree (subsection_code);


--
-- Name: idx_foundation_profiles_foundation_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_foundation_profiles_foundation_id ON public.foundation_profiles USING btree (foundation_id);


--
-- Name: idx_funder_dna_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funder_dna_funder ON public.funder_dna_profiles USING btree (funder_id);


--
-- Name: idx_funder_dna_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funder_dna_org ON public.funder_dna_profiles USING btree (organization_id);


--
-- Name: idx_funder_intelligence_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funder_intelligence_funder ON public.funder_intelligence USING btree (funder_id);


--
-- Name: idx_funder_intelligence_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funder_intelligence_org ON public.funder_intelligence USING btree (organization_id);


--
-- Name: idx_funder_rel_events_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funder_rel_events_date ON public.funder_relationship_events USING btree (event_date DESC);


--
-- Name: idx_funder_rel_events_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funder_rel_events_funder ON public.funder_relationship_events USING btree (funder_id);


--
-- Name: idx_funder_rel_events_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funder_rel_events_org ON public.funder_relationship_events USING btree (organization_id);


--
-- Name: idx_funder_rel_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funder_rel_org ON public.funder_relationship_scores USING btree (organization_id);


--
-- Name: idx_funder_rel_signals_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funder_rel_signals_funder ON public.funder_relationship_signals USING btree (funder_id, signal_type, created_at DESC);


--
-- Name: idx_funder_rel_signals_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funder_rel_signals_org ON public.funder_relationship_signals USING btree (org_id, relationship_score DESC, created_at DESC);


--
-- Name: idx_funders_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funders_category ON public.funders USING btree (category);


--
-- Name: idx_funders_contact_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funders_contact_email ON public.funders USING btree (contact_email) WHERE (contact_email IS NOT NULL);


--
-- Name: idx_funders_name; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funders_name ON public.funders USING btree (name);


--
-- Name: idx_funders_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_funders_org ON public.funders USING btree (organization_id);


--
-- Name: idx_giving_history_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_giving_history_funder ON public.funder_giving_history USING btree (funder_id);


--
-- Name: idx_giving_history_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_giving_history_org ON public.funder_giving_history USING btree (organization_id);


--
-- Name: idx_grant_budgets_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_budgets_application ON public.grant_budgets USING btree (application_id);


--
-- Name: idx_grant_budgets_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_budgets_org ON public.grant_budgets USING btree (organization_id);


--
-- Name: idx_grant_expenses_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_expenses_application ON public.grant_expenses USING btree (application_id);


--
-- Name: idx_grant_expenses_budget; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_expenses_budget ON public.grant_expenses USING btree (budget_id);


--
-- Name: idx_grant_expenses_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_expenses_org ON public.grant_expenses USING btree (organization_id);


--
-- Name: idx_grant_reconciliation_reports_application; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_reconciliation_reports_application ON public.grant_reconciliation_reports USING btree (application_id);


--
-- Name: idx_grant_reconciliation_reports_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grant_reconciliation_reports_org ON public.grant_reconciliation_reports USING btree (organization_id);


--
-- Name: idx_grantmaker_profiles_ein; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grantmaker_profiles_ein ON public.intelligence_grantmaker_profiles USING btree (ein);


--
-- Name: idx_grantmaker_profiles_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_grantmaker_profiles_geo ON public.intelligence_grantmaker_profiles USING gin (geographic_focus);


--
-- Name: idx_historical_awards_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_historical_awards_org ON public.historical_awards USING btree (organization_id);


--
-- Name: idx_impersonation_admin; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_impersonation_admin ON public.impersonation_log USING btree (admin_id);


--
-- Name: idx_integration_keys_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_integration_keys_org ON public.integration_keys USING btree (organization_id);


--
-- Name: idx_integrations_org_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_integrations_org_provider ON public.integrations USING btree (organization_id, provider);


--
-- Name: idx_invitations_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_email ON public.user_invitations USING btree (email);


--
-- Name: idx_invitations_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invitations_org ON public.user_invitations USING btree (organization_id);


--
-- Name: idx_invitations_token; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_invitations_token ON public.user_invitations USING btree (token);


--
-- Name: idx_invoices_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_invoices_org ON public.invoices USING btree (organization_id);


--
-- Name: idx_kb_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_category ON public.knowledge_base USING btree (category);


--
-- Name: idx_kb_keywords; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_keywords ON public.knowledge_base USING gin (keywords);


--
-- Name: idx_kb_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_org ON public.knowledge_base USING btree (organization_id);


--
-- Name: idx_kb_proven; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_kb_proven ON public.knowledge_base USING btree (is_proven);


--
-- Name: idx_learning_patterns_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_learning_patterns_type ON public.platform_learning_patterns USING btree (pattern_type, funder_category, ntee_code);


--
-- Name: idx_marketplace_listings_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_listings_category ON public.marketplace_listings USING btree (category);


--
-- Name: idx_marketplace_listings_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_listings_org ON public.marketplace_listings USING btree (organization_id);


--
-- Name: idx_marketplace_listings_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_listings_status ON public.marketplace_listings USING btree (status);


--
-- Name: idx_marketplace_matches_listing; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_matches_listing ON public.marketplace_matches USING btree (listing_id);


--
-- Name: idx_marketplace_matches_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_marketplace_matches_org ON public.marketplace_matches USING btree (organization_id, status);


--
-- Name: idx_need_data_geo; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_need_data_geo ON public.intelligence_need_data USING btree (geographic_level, state, county);


--
-- Name: idx_nonprofits_ein; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nonprofits_ein ON public.nonprofits USING btree (ein);


--
-- Name: idx_nonprofits_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_nonprofits_state ON public.nonprofits USING btree (state);


--
-- Name: idx_notes_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_app ON public.notes USING btree (application_id);


--
-- Name: idx_notes_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_funder ON public.notes USING btree (funder_id);


--
-- Name: idx_notes_opp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notes_opp ON public.notes USING btree (opportunity_id);


--
-- Name: idx_onboarding_org_step; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_onboarding_org_step ON public.onboarding_steps USING btree (organization_id, step_number);


--
-- Name: idx_opp_keywords_keyword; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opp_keywords_keyword ON public.opportunity_keywords USING btree (keyword);


--
-- Name: idx_opp_keywords_opp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opp_keywords_opp ON public.opportunity_keywords USING btree (opportunity_id);


--
-- Name: idx_opportunities_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_category ON public.opportunities USING btree (category);


--
-- Name: idx_opportunities_deadline; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_deadline ON public.opportunities USING btree (deadline);


--
-- Name: idx_opportunities_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_funder ON public.opportunities USING btree (funder_id);


--
-- Name: idx_opportunities_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_org ON public.opportunities USING btree (organization_id);


--
-- Name: idx_opportunities_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_opportunities_status ON public.opportunities USING btree (status);


--
-- Name: idx_org_documents_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_documents_type ON public.org_documents USING btree (organization_id, document_type, is_current);


--
-- Name: idx_org_settings_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_settings_org ON public.org_settings USING btree (organization_id);


--
-- Name: idx_org_usage_org_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_org_usage_org_date ON public.org_usage_summary USING btree (organization_id, period_date DESC);


--
-- Name: idx_organizations_ein; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_organizations_ein ON public.organizations USING btree (ein);


--
-- Name: idx_outcomes_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outcomes_app ON public.outcomes USING btree (application_id);


--
-- Name: idx_outcomes_funder_cat; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outcomes_funder_cat ON public.outcomes USING btree (funder_category);


--
-- Name: idx_outcomes_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outcomes_org ON public.outcomes USING btree (organization_id);


--
-- Name: idx_outcomes_result; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outcomes_result ON public.outcomes USING btree (result);


--
-- Name: idx_outreach_template_variants_one_active; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_outreach_template_variants_one_active ON public.outreach_template_variants USING btree (template_id) WHERE is_active;


--
-- Name: idx_outreach_template_variants_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_template_variants_org ON public.outreach_template_variants USING btree (organization_id);


--
-- Name: idx_outreach_template_variants_template; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_template_variants_template ON public.outreach_template_variants USING btree (template_id);


--
-- Name: idx_outreach_templates_channel; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_templates_channel ON public.outreach_templates USING btree (organization_id, channel);


--
-- Name: idx_outreach_templates_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_outreach_templates_org ON public.outreach_templates USING btree (organization_id);


--
-- Name: idx_pig_edges_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pig_edges_source ON public.pig_edges USING btree (source_node_id);


--
-- Name: idx_pig_edges_target; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pig_edges_target ON public.pig_edges USING btree (target_node_id);


--
-- Name: idx_pig_edges_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pig_edges_type ON public.pig_edges USING btree (relationship_type);


--
-- Name: idx_pig_nodes_entity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pig_nodes_entity ON public.pig_nodes USING btree (entity_table, entity_id);


--
-- Name: idx_pipeline_history_app; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_history_app ON public.pipeline_history USING btree (application_id);


--
-- Name: idx_pipeline_history_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pipeline_history_date ON public.pipeline_history USING btree (created_at);


--
-- Name: idx_pitch_cache_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_pitch_cache_lookup ON public.pitch_cache USING btree (organization_id, funder_id, request_profile_id);


--
-- Name: idx_platform_admins_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_admins_user ON public.platform_admins USING btree (user_id);


--
-- Name: idx_platform_tasks_assigned; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_tasks_assigned ON public.platform_tasks USING btree (assigned_to);


--
-- Name: idx_platform_tasks_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_platform_tasks_status ON public.platform_tasks USING btree (status);


--
-- Name: idx_prob_scores_opp; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prob_scores_opp ON public.opportunity_probability_scores USING btree (opportunity_id);


--
-- Name: idx_prob_scores_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prob_scores_org ON public.opportunity_probability_scores USING btree (organization_id);


--
-- Name: idx_profiles_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_email ON public.profiles USING btree (email);


--
-- Name: idx_profiles_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_profiles_org ON public.profiles USING btree (organization_id);


--
-- Name: idx_proposal_sections_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proposal_sections_embedding ON public.intelligence_proposal_sections USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists='100');


--
-- Name: idx_prospects_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_email ON public.prospects USING btree (email);


--
-- Name: idx_prospects_list; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_list ON public.prospects USING btree (list_id);


--
-- Name: idx_prospects_state; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_state ON public.prospects USING btree (state);


--
-- Name: idx_prospects_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_prospects_status ON public.prospects USING btree (status) WHERE (suppressed = false);


--
-- Name: idx_proven_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proven_category ON public.proven_narratives USING btree (funder_category);


--
-- Name: idx_proven_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proven_org ON public.proven_narratives USING btree (organization_id);


--
-- Name: idx_proven_score; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_proven_score ON public.proven_narratives USING btree (effectiveness_score DESC);


--
-- Name: idx_rel_memory_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rel_memory_org ON public.relationship_memory USING btree (org_id, entity_id);


--
-- Name: idx_rel_recs_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rel_recs_org ON public.relationship_recommendations USING btree (org_id, status);


--
-- Name: idx_reputation_alerts_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_reputation_alerts_org ON public.reputation_alerts USING btree (org_id, status);


--
-- Name: idx_request_profiles_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_request_profiles_org ON public.request_profiles USING btree (organization_id, active);


--
-- Name: idx_research_cache_expires; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_research_cache_expires ON public.research_cache USING btree (expires_at);


--
-- Name: idx_research_cache_url; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_research_cache_url ON public.research_cache USING btree (organization_id, url);


--
-- Name: idx_rubrics_embedding; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_rubrics_embedding ON public.intelligence_scoring_rubrics USING ivfflat (embedding extensions.vector_cosine_ops) WITH (lists='50');


--
-- Name: idx_sales_sends_campaign; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_sends_campaign ON public.sales_sends USING btree (campaign_id);


--
-- Name: idx_sales_sends_scheduled; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_sends_scheduled ON public.sales_sends USING btree (scheduled_for) WHERE (status = 'queued'::text);


--
-- Name: idx_sales_sends_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_sales_sends_status ON public.sales_sends USING btree (status);


--
-- Name: idx_scrape_jobs_keyword; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scrape_jobs_keyword ON public.scrape_jobs USING btree (keyword);


--
-- Name: idx_scrape_jobs_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scrape_jobs_status ON public.scrape_jobs USING btree (status);


--
-- Name: idx_scrape_results_job_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scrape_results_job_id ON public.scrape_results USING btree (job_id);


--
-- Name: idx_scraping_targets_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_scraping_targets_org ON public.scraping_targets USING btree (organization_id);


--
-- Name: idx_simulations_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_simulations_org ON public.impact_simulations USING btree (org_id);


--
-- Name: idx_submission_queue_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_queue_org ON public.submission_queue USING btree (organization_id);


--
-- Name: idx_submission_queue_pending; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_queue_pending ON public.submission_queue USING btree (priority, created_at) WHERE (status = 'pending'::text);


--
-- Name: idx_submission_queue_priority; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_queue_priority ON public.submission_queue USING btree (priority, scheduled_for);


--
-- Name: idx_submission_queue_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_submission_queue_status ON public.submission_queue USING btree (status);


--
-- Name: idx_subscriptions_org; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_subscriptions_org ON public.subscriptions USING btree (organization_id);


--
-- Name: idx_success_prob_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_success_prob_org ON public.success_probability_scores USING btree (organization_id);


--
-- Name: idx_suppression_email; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_suppression_email ON public.suppression_list USING btree (email);


--
-- Name: idx_system_errors_resolved; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_errors_resolved ON public.system_errors USING btree (is_resolved, last_seen_at DESC);


--
-- Name: idx_system_errors_source; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_system_errors_source ON public.system_errors USING btree (source);


--
-- Name: idx_team_activity_date; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_activity_date ON public.team_activity_log USING btree (created_at DESC);


--
-- Name: idx_team_activity_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_activity_org ON public.team_activity_log USING btree (organization_id);


--
-- Name: idx_team_activity_user; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_team_activity_user ON public.team_activity_log USING btree (user_id);


--
-- Name: idx_usage_metrics_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_metrics_org ON public.usage_metrics USING btree (organization_id);


--
-- Name: idx_usage_metrics_unique; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX idx_usage_metrics_unique ON public.usage_metrics USING btree (organization_id, metric_date, metric_name);


--
-- Name: idx_usage_tracking_lookup; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_usage_tracking_lookup ON public.usage_tracking USING btree (organization_id, resource_type, period_start);


--
-- Name: idx_validations_opportunity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validations_opportunity ON public.validations USING btree (opportunity_id);


--
-- Name: idx_validations_org; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_validations_org ON public.validations USING btree (organization_id);


--
-- Name: renewals_application_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renewals_application_id_idx ON public.renewals USING btree (application_id);


--
-- Name: renewals_organization_id_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renewals_organization_id_idx ON public.renewals USING btree (organization_id);


--
-- Name: renewals_reporting_deadline_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX renewals_reporting_deadline_idx ON public.renewals USING btree (reporting_deadline);


--
-- Name: uq_alerts_org_dedup; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_alerts_org_dedup ON public.alerts USING btree (organization_id, dedup_key);


--
-- Name: uq_draft_versions_opp_version; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_draft_versions_opp_version ON public.draft_versions USING btree (opportunity_id, version_number);


--
-- Name: uq_funder_intelligence_org_funder; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_funder_intelligence_org_funder ON public.funder_intelligence USING btree (organization_id, funder_id);


--
-- Name: uq_historical_awards_org_award; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_historical_awards_org_award ON public.historical_awards USING btree (organization_id, award_id);


--
-- Name: uq_validations_opportunity_provider; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX uq_validations_opportunity_provider ON public.validations USING btree (opportunity_id, provider);


--
-- Name: ix_realtime_subscription_entity; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX ix_realtime_subscription_entity ON realtime.subscription USING btree (entity);


--
-- Name: messages_inserted_at_topic_index; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_inserted_at_topic_index ON ONLY realtime.messages USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_18_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_18_inserted_at_topic_idx ON realtime.messages_2026_08_18 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_19_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_19_inserted_at_topic_idx ON realtime.messages_2026_08_19 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_20_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_20_inserted_at_topic_idx ON realtime.messages_2026_08_20 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_21_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_21_inserted_at_topic_idx ON realtime.messages_2026_08_21 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_22_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_22_inserted_at_topic_idx ON realtime.messages_2026_08_22 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_23_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_23_inserted_at_topic_idx ON realtime.messages_2026_08_23 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: messages_2026_08_24_inserted_at_topic_idx; Type: INDEX; Schema: realtime; Owner: -
--

CREATE INDEX messages_2026_08_24_inserted_at_topic_idx ON realtime.messages_2026_08_24 USING btree (inserted_at DESC, topic) WHERE ((extension = 'broadcast'::text) AND (private IS TRUE));


--
-- Name: subscription_subscription_id_entity_filters_action_filter_selec; Type: INDEX; Schema: realtime; Owner: -
--

CREATE UNIQUE INDEX subscription_subscription_id_entity_filters_action_filter_selec ON realtime.subscription USING btree (subscription_id, entity, filters, action_filter, COALESCE(selected_columns, '{}'::text[]));


--
-- Name: bname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bname ON storage.buckets USING btree (name);


--
-- Name: bucketid_objname; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX bucketid_objname ON storage.objects USING btree (bucket_id, name);


--
-- Name: buckets_analytics_unique_name_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX buckets_analytics_unique_name_idx ON storage.buckets_analytics USING btree (name) WHERE (deleted_at IS NULL);


--
-- Name: idx_multipart_uploads_list; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_multipart_uploads_list ON storage.s3_multipart_uploads USING btree (bucket_id, key, created_at);


--
-- Name: idx_objects_bucket_id_name; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name ON storage.objects USING btree (bucket_id, name COLLATE "C");


--
-- Name: idx_objects_bucket_id_name_lower; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX idx_objects_bucket_id_name_lower ON storage.objects USING btree (bucket_id, lower(name) COLLATE "C");


--
-- Name: name_prefix_search; Type: INDEX; Schema: storage; Owner: -
--

CREATE INDEX name_prefix_search ON storage.objects USING btree (name text_pattern_ops);


--
-- Name: vector_indexes_name_bucket_id_idx; Type: INDEX; Schema: storage; Owner: -
--

CREATE UNIQUE INDEX vector_indexes_name_bucket_id_idx ON storage.vector_indexes USING btree (name, bucket_id);


--
-- Name: messages_2026_08_18_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_18_inserted_at_topic_idx;


--
-- Name: messages_2026_08_18_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_18_pkey;


--
-- Name: messages_2026_08_19_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_19_inserted_at_topic_idx;


--
-- Name: messages_2026_08_19_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_19_pkey;


--
-- Name: messages_2026_08_20_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_20_inserted_at_topic_idx;


--
-- Name: messages_2026_08_20_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_20_pkey;


--
-- Name: messages_2026_08_21_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_21_inserted_at_topic_idx;


--
-- Name: messages_2026_08_21_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_21_pkey;


--
-- Name: messages_2026_08_22_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_22_inserted_at_topic_idx;


--
-- Name: messages_2026_08_22_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_22_pkey;


--
-- Name: messages_2026_08_23_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_23_inserted_at_topic_idx;


--
-- Name: messages_2026_08_23_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_23_pkey;


--
-- Name: messages_2026_08_24_inserted_at_topic_idx; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_inserted_at_topic_index ATTACH PARTITION realtime.messages_2026_08_24_inserted_at_topic_idx;


--
-- Name: messages_2026_08_24_pkey; Type: INDEX ATTACH; Schema: realtime; Owner: -
--

ALTER INDEX realtime.messages_pkey ATTACH PARTITION realtime.messages_2026_08_24_pkey;


--
-- Name: outcomes auto_create_renewal_on_outcome; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER auto_create_renewal_on_outcome AFTER INSERT ON public.outcomes FOR EACH ROW EXECUTE FUNCTION public.auto_create_renewal();


--
-- Name: organizations block_restricted_organizations_update; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER block_restricted_organizations_update BEFORE UPDATE ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.block_restricted_organizations_update();


--
-- Name: board_members block_restricted_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER block_restricted_write BEFORE INSERT OR DELETE OR UPDATE ON public.board_members FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();


--
-- Name: documents block_restricted_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER block_restricted_write BEFORE INSERT OR DELETE OR UPDATE ON public.documents FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();


--
-- Name: knowledge_base block_restricted_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER block_restricted_write BEFORE INSERT OR DELETE OR UPDATE ON public.knowledge_base FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();


--
-- Name: organizational_digital_twins block_restricted_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER block_restricted_write BEFORE INSERT OR DELETE OR UPDATE ON public.organizational_digital_twins FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();


--
-- Name: programs block_restricted_write; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER block_restricted_write BEFORE INSERT OR DELETE OR UPDATE ON public.programs FOR EACH ROW EXECUTE FUNCTION public.block_if_onboarding_edit_restricted();


--
-- Name: renewals renewals_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER renewals_updated_at BEFORE UPDATE ON public.renewals FOR EACH ROW EXECUTE FUNCTION public.renewals_set_updated_at();


--
-- Name: organizations trg_seed_platform_config; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_seed_platform_config AFTER INSERT ON public.organizations FOR EACH ROW EXECUTE FUNCTION public.seed_default_platform_config();


--
-- Name: draft_versions trg_set_draft_version_number; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_set_draft_version_number BEFORE INSERT ON public.draft_versions FOR EACH ROW EXECUTE FUNCTION public.set_draft_version_number();


--
-- Name: subscription tr_check_filters; Type: TRIGGER; Schema: realtime; Owner: -
--

CREATE TRIGGER tr_check_filters BEFORE INSERT OR UPDATE ON realtime.subscription FOR EACH ROW EXECUTE FUNCTION realtime.subscription_check_filters();


--
-- Name: buckets enforce_bucket_name_length_trigger; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER enforce_bucket_name_length_trigger BEFORE INSERT OR UPDATE OF name ON storage.buckets FOR EACH ROW EXECUTE FUNCTION storage.enforce_bucket_name_length();


--
-- Name: buckets protect_buckets_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_buckets_delete BEFORE DELETE ON storage.buckets FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects protect_objects_delete; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER protect_objects_delete BEFORE DELETE ON storage.objects FOR EACH STATEMENT EXECUTE FUNCTION storage.protect_delete();


--
-- Name: objects update_objects_updated_at; Type: TRIGGER; Schema: storage; Owner: -
--

CREATE TRIGGER update_objects_updated_at BEFORE UPDATE ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.update_updated_at_column();


--
-- Name: identities identities_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.identities
    ADD CONSTRAINT identities_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: mfa_amr_claims mfa_amr_claims_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_amr_claims
    ADD CONSTRAINT mfa_amr_claims_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: mfa_challenges mfa_challenges_auth_factor_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_challenges
    ADD CONSTRAINT mfa_challenges_auth_factor_id_fkey FOREIGN KEY (factor_id) REFERENCES auth.mfa_factors(id) ON DELETE CASCADE;


--
-- Name: mfa_factors mfa_factors_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.mfa_factors
    ADD CONSTRAINT mfa_factors_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_authorizations oauth_authorizations_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_authorizations
    ADD CONSTRAINT oauth_authorizations_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_client_id_fkey FOREIGN KEY (client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: oauth_consents oauth_consents_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.oauth_consents
    ADD CONSTRAINT oauth_consents_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: one_time_tokens one_time_tokens_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.one_time_tokens
    ADD CONSTRAINT one_time_tokens_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: refresh_tokens refresh_tokens_session_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.refresh_tokens
    ADD CONSTRAINT refresh_tokens_session_id_fkey FOREIGN KEY (session_id) REFERENCES auth.sessions(id) ON DELETE CASCADE;


--
-- Name: saml_providers saml_providers_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_providers
    ADD CONSTRAINT saml_providers_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_flow_state_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_flow_state_id_fkey FOREIGN KEY (flow_state_id) REFERENCES auth.flow_state(id) ON DELETE CASCADE;


--
-- Name: saml_relay_states saml_relay_states_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.saml_relay_states
    ADD CONSTRAINT saml_relay_states_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_oauth_client_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_oauth_client_id_fkey FOREIGN KEY (oauth_client_id) REFERENCES auth.oauth_clients(id) ON DELETE CASCADE;


--
-- Name: sessions sessions_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sessions
    ADD CONSTRAINT sessions_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: sso_domains sso_domains_sso_provider_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.sso_domains
    ADD CONSTRAINT sso_domains_sso_provider_id_fkey FOREIGN KEY (sso_provider_id) REFERENCES auth.sso_providers(id) ON DELETE CASCADE;


--
-- Name: webauthn_challenges webauthn_challenges_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_challenges
    ADD CONSTRAINT webauthn_challenges_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: webauthn_credentials webauthn_credentials_user_id_fkey; Type: FK CONSTRAINT; Schema: auth; Owner: -
--

ALTER TABLE ONLY auth.webauthn_credentials
    ADD CONSTRAINT webauthn_credentials_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: agent_configurations agent_configurations_agent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_configurations
    ADD CONSTRAINT agent_configurations_agent_id_fkey FOREIGN KEY (agent_id) REFERENCES public.agent_registry(agent_id) ON DELETE CASCADE;


--
-- Name: agent_decisions agent_decisions_agent_run_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_decisions
    ADD CONSTRAINT agent_decisions_agent_run_id_fkey FOREIGN KEY (agent_run_id) REFERENCES public.agent_runs(id);


--
-- Name: agent_decisions agent_decisions_human_reviewer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_decisions
    ADD CONSTRAINT agent_decisions_human_reviewer_id_fkey FOREIGN KEY (human_reviewer_id) REFERENCES public.profiles(id);


--
-- Name: agent_decisions agent_decisions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_decisions
    ADD CONSTRAINT agent_decisions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: agent_queue agent_queue_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_queue
    ADD CONSTRAINT agent_queue_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: agent_runs agent_runs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: agent_runs agent_runs_triggered_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.agent_runs
    ADD CONSTRAINT agent_runs_triggered_by_fkey FOREIGN KEY (triggered_by) REFERENCES public.profiles(id);


--
-- Name: ai_usage_log ai_usage_log_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_log
    ADD CONSTRAINT ai_usage_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: alerts alerts_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: alerts alerts_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: alerts alerts_deadline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_deadline_id_fkey FOREIGN KEY (deadline_id) REFERENCES public.deadlines(id) ON DELETE CASCADE;


--
-- Name: alerts alerts_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: alerts alerts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: application_documents application_documents_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_documents
    ADD CONSTRAINT application_documents_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: application_documents application_documents_document_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.application_documents
    ADD CONSTRAINT application_documents_document_id_fkey FOREIGN KEY (document_id) REFERENCES public.documents(id) ON DELETE CASCADE;


--
-- Name: applications applications_assigned_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_assigned_user_id_fkey FOREIGN KEY (assigned_user_id) REFERENCES public.profiles(id);


--
-- Name: applications applications_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id);


--
-- Name: applications applications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.applications
    ADD CONSTRAINT applications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: audit_logs audit_logs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: auto_queue_config auto_queue_config_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.auto_queue_config
    ADD CONSTRAINT auto_queue_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: autoapply_confirmation_processed_messages autoapply_confirmation_processed_mes_matched_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_confirmation_processed_messages
    ADD CONSTRAINT autoapply_confirmation_processed_mes_matched_submission_id_fkey FOREIGN KEY (matched_submission_id) REFERENCES public.autoapply_submissions(id) ON DELETE SET NULL;


--
-- Name: autoapply_follow_ups autoapply_follow_ups_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_follow_ups
    ADD CONSTRAINT autoapply_follow_ups_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: autoapply_follow_ups autoapply_follow_ups_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_follow_ups
    ADD CONSTRAINT autoapply_follow_ups_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: autoapply_follow_ups autoapply_follow_ups_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_follow_ups
    ADD CONSTRAINT autoapply_follow_ups_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.autoapply_submissions(id) ON DELETE CASCADE;


--
-- Name: autoapply_review_queue autoapply_review_queue_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_review_queue
    ADD CONSTRAINT autoapply_review_queue_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id);


--
-- Name: autoapply_review_queue autoapply_review_queue_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_review_queue
    ADD CONSTRAINT autoapply_review_queue_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.autoapply_submissions(id) ON DELETE CASCADE;


--
-- Name: autoapply_screenshots autoapply_screenshots_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_screenshots
    ADD CONSTRAINT autoapply_screenshots_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.autoapply_submissions(id) ON DELETE CASCADE;


--
-- Name: autoapply_submissions autoapply_submissions_form_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_submissions
    ADD CONSTRAINT autoapply_submissions_form_template_id_fkey FOREIGN KEY (form_template_id) REFERENCES public.form_templates(id) ON DELETE SET NULL;


--
-- Name: autoapply_submissions autoapply_submissions_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_submissions
    ADD CONSTRAINT autoapply_submissions_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE SET NULL;


--
-- Name: autoapply_submissions autoapply_submissions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_submissions
    ADD CONSTRAINT autoapply_submissions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: autoapply_submissions autoapply_submissions_request_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autoapply_submissions
    ADD CONSTRAINT autoapply_submissions_request_profile_id_fkey FOREIGN KEY (request_profile_id) REFERENCES public.request_profiles(id);


--
-- Name: automation_notifications automation_notifications_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_notifications
    ADD CONSTRAINT automation_notifications_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: automation_queue automation_queue_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_queue
    ADD CONSTRAINT automation_queue_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id);


--
-- Name: automation_queue automation_queue_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_queue
    ADD CONSTRAINT automation_queue_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: automation_screenshots automation_screenshots_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_screenshots
    ADD CONSTRAINT automation_screenshots_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.automation_sessions(id) ON DELETE CASCADE;


--
-- Name: automation_screenshots automation_screenshots_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_screenshots
    ADD CONSTRAINT automation_screenshots_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.automation_steps(id) ON DELETE SET NULL;


--
-- Name: automation_sessions automation_sessions_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_sessions
    ADD CONSTRAINT automation_sessions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: automation_sessions automation_sessions_approved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_sessions
    ADD CONSTRAINT automation_sessions_approved_by_fkey FOREIGN KEY (approved_by) REFERENCES public.profiles(id);


--
-- Name: automation_sessions automation_sessions_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_sessions
    ADD CONSTRAINT automation_sessions_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE SET NULL;


--
-- Name: automation_sessions automation_sessions_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_sessions
    ADD CONSTRAINT automation_sessions_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: automation_sessions automation_sessions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_sessions
    ADD CONSTRAINT automation_sessions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: automation_sessions automation_sessions_started_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_sessions
    ADD CONSTRAINT automation_sessions_started_by_fkey FOREIGN KEY (started_by) REFERENCES public.profiles(id);


--
-- Name: automation_steps automation_steps_session_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.automation_steps
    ADD CONSTRAINT automation_steps_session_id_fkey FOREIGN KEY (session_id) REFERENCES public.automation_sessions(id) ON DELETE CASCADE;


--
-- Name: autonomous_triggers autonomous_triggers_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.autonomous_triggers
    ADD CONSTRAINT autonomous_triggers_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: board_meeting_packets board_meeting_packets_meeting_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_meeting_packets
    ADD CONSTRAINT board_meeting_packets_meeting_id_fkey FOREIGN KEY (meeting_id) REFERENCES public.board_meetings(id) ON DELETE CASCADE;


--
-- Name: board_members board_members_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.board_members
    ADD CONSTRAINT board_members_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: calendar_connections calendar_connections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: calendar_connections calendar_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_connections
    ADD CONSTRAINT calendar_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_connection_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_connection_id_fkey FOREIGN KEY (connection_id) REFERENCES public.calendar_connections(id) ON DELETE CASCADE;


--
-- Name: calendar_events calendar_events_linked_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_linked_application_id_fkey FOREIGN KEY (linked_application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_linked_deadline_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_linked_deadline_id_fkey FOREIGN KEY (linked_deadline_id) REFERENCES public.deadlines(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_linked_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_linked_opportunity_id_fkey FOREIGN KEY (linked_opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: calendar_events calendar_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.calendar_events
    ADD CONSTRAINT calendar_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: campaign_sends campaign_sends_campaign_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_sends
    ADD CONSTRAINT campaign_sends_campaign_step_id_fkey FOREIGN KEY (campaign_step_id) REFERENCES public.campaign_steps(id);


--
-- Name: campaign_sends campaign_sends_outreach_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_sends
    ADD CONSTRAINT campaign_sends_outreach_contact_id_fkey FOREIGN KEY (outreach_contact_id) REFERENCES public.outreach_contacts(id);


--
-- Name: campaign_steps campaign_steps_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.campaign_steps
    ADD CONSTRAINT campaign_steps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.email_campaigns(id) ON DELETE CASCADE;


--
-- Name: community_need_signals community_need_signals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_need_signals
    ADD CONSTRAINT community_need_signals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: competitor_tracking competitor_tracking_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_tracking
    ADD CONSTRAINT competitor_tracking_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id);


--
-- Name: competitor_tracking competitor_tracking_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_tracking
    ADD CONSTRAINT competitor_tracking_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: competitor_tracking competitor_tracking_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.competitor_tracking
    ADD CONSTRAINT competitor_tracking_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: compliance_events compliance_events_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: compliance_events compliance_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.compliance_events
    ADD CONSTRAINT compliance_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: contact_tasks contact_tasks_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tasks
    ADD CONSTRAINT contact_tasks_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: contact_tasks contact_tasks_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tasks
    ADD CONSTRAINT contact_tasks_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: contact_tasks contact_tasks_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contact_tasks
    ADD CONSTRAINT contact_tasks_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: contacts contacts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.contacts
    ADD CONSTRAINT contacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: corporate_intent_signals corporate_intent_signals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_intent_signals
    ADD CONSTRAINT corporate_intent_signals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: corporate_prospects corporate_prospects_parent_company_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_prospects
    ADD CONSTRAINT corporate_prospects_parent_company_id_fkey FOREIGN KEY (parent_company_id) REFERENCES public.corporate_prospects(id);


--
-- Name: corporate_relationships corporate_relationships_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.corporate_relationships
    ADD CONSTRAINT corporate_relationships_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: custom_api_connections custom_api_connections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_api_connections
    ADD CONSTRAINT custom_api_connections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: custom_connector_allowlist custom_connector_allowlist_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_connector_allowlist
    ADD CONSTRAINT custom_connector_allowlist_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: custom_connector_allowlist custom_connector_allowlist_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.custom_connector_allowlist
    ADD CONSTRAINT custom_connector_allowlist_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: dd_prospect_requests dd_prospect_requests_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dd_prospect_requests
    ADD CONSTRAINT dd_prospect_requests_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.donor_discovery_prospects(id) ON DELETE CASCADE;


--
-- Name: dd_prospect_requests dd_prospect_requests_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.dd_prospect_requests
    ADD CONSTRAINT dd_prospect_requests_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.donor_discovery_requests(id) ON DELETE CASCADE;


--
-- Name: deadlines deadlines_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deadlines
    ADD CONSTRAINT deadlines_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: deadlines deadlines_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deadlines
    ADD CONSTRAINT deadlines_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: deadlines deadlines_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.deadlines
    ADD CONSTRAINT deadlines_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: documents documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: documents documents_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.documents
    ADD CONSTRAINT documents_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.profiles(id);


--
-- Name: donor_discovery_connectors donor_discovery_connectors_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_connectors
    ADD CONSTRAINT donor_discovery_connectors_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: donor_discovery_directory donor_discovery_directory_linked_foundation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_directory
    ADD CONSTRAINT donor_discovery_directory_linked_foundation_id_fkey FOREIGN KEY (linked_foundation_id) REFERENCES public.foundation_directory(id) ON DELETE SET NULL;


--
-- Name: donor_discovery_prospects donor_discovery_prospects_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_prospects
    ADD CONSTRAINT donor_discovery_prospects_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.profiles(id);


--
-- Name: donor_discovery_prospects donor_discovery_prospects_directory_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_prospects
    ADD CONSTRAINT donor_discovery_prospects_directory_id_fkey FOREIGN KEY (directory_id) REFERENCES public.donor_discovery_directory(id) ON DELETE CASCADE;


--
-- Name: donor_discovery_prospects donor_discovery_prospects_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_prospects
    ADD CONSTRAINT donor_discovery_prospects_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: donor_discovery_prospects donor_discovery_prospects_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_prospects
    ADD CONSTRAINT donor_discovery_prospects_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.donor_discovery_requests(id) ON DELETE CASCADE;


--
-- Name: donor_discovery_requests donor_discovery_requests_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_requests
    ADD CONSTRAINT donor_discovery_requests_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: donor_discovery_requests donor_discovery_requests_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_requests
    ADD CONSTRAINT donor_discovery_requests_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: donor_discovery_taxonomy_aliases donor_discovery_taxonomy_aliases_taxonomy_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_taxonomy_aliases
    ADD CONSTRAINT donor_discovery_taxonomy_aliases_taxonomy_id_fkey FOREIGN KEY (taxonomy_id) REFERENCES public.donor_discovery_taxonomy(id) ON DELETE CASCADE;


--
-- Name: donor_discovery_taxonomy donor_discovery_taxonomy_parent_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.donor_discovery_taxonomy
    ADD CONSTRAINT donor_discovery_taxonomy_parent_id_fkey FOREIGN KEY (parent_id) REFERENCES public.donor_discovery_taxonomy(id) ON DELETE SET NULL;


--
-- Name: draft_automation_config draft_automation_config_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_automation_config
    ADD CONSTRAINT draft_automation_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: draft_queue draft_queue_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_queue
    ADD CONSTRAINT draft_queue_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id);


--
-- Name: draft_queue draft_queue_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_queue
    ADD CONSTRAINT draft_queue_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: draft_queue draft_queue_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_queue
    ADD CONSTRAINT draft_queue_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: draft_queue draft_queue_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_queue
    ADD CONSTRAINT draft_queue_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);


--
-- Name: draft_versions draft_versions_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_versions
    ADD CONSTRAINT draft_versions_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: draft_versions draft_versions_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_versions
    ADD CONSTRAINT draft_versions_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: draft_versions draft_versions_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_versions
    ADD CONSTRAINT draft_versions_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: draft_versions draft_versions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.draft_versions
    ADD CONSTRAINT draft_versions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: email_activity email_activity_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_activity
    ADD CONSTRAINT email_activity_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE SET NULL;


--
-- Name: email_activity email_activity_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_activity
    ADD CONSTRAINT email_activity_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE SET NULL;


--
-- Name: email_activity email_activity_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_activity
    ADD CONSTRAINT email_activity_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE SET NULL;


--
-- Name: email_activity email_activity_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_activity
    ADD CONSTRAINT email_activity_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: email_campaign_sequences email_campaign_sequences_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_sequences
    ADD CONSTRAINT email_campaign_sequences_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: email_campaign_sequences email_campaign_sequences_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaign_sequences
    ADD CONSTRAINT email_campaign_sequences_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: email_campaigns email_campaigns_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: email_campaigns email_campaigns_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_campaigns
    ADD CONSTRAINT email_campaigns_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: email_connections email_connections_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: email_connections email_connections_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_connections
    ADD CONSTRAINT email_connections_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;


--
-- Name: email_sequence_enrollments email_sequence_enrollments_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sequence_enrollments
    ADD CONSTRAINT email_sequence_enrollments_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE SET NULL;


--
-- Name: email_sequence_enrollments email_sequence_enrollments_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sequence_enrollments
    ADD CONSTRAINT email_sequence_enrollments_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE SET NULL;


--
-- Name: email_sequence_enrollments email_sequence_enrollments_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sequence_enrollments
    ADD CONSTRAINT email_sequence_enrollments_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: email_sequence_enrollments email_sequence_enrollments_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sequence_enrollments
    ADD CONSTRAINT email_sequence_enrollments_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.email_campaign_sequences(id) ON DELETE CASCADE;


--
-- Name: email_sequence_steps email_sequence_steps_sequence_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sequence_steps
    ADD CONSTRAINT email_sequence_steps_sequence_id_fkey FOREIGN KEY (sequence_id) REFERENCES public.email_campaign_sequences(id) ON DELETE CASCADE;


--
-- Name: email_sequence_steps email_sequence_steps_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_sequence_steps
    ADD CONSTRAINT email_sequence_steps_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.email_templates(id) ON DELETE SET NULL;


--
-- Name: email_templates email_templates_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: email_templates email_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_templates
    ADD CONSTRAINT email_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: email_thread_links email_thread_links_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_thread_links
    ADD CONSTRAINT email_thread_links_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES public.contacts(id) ON DELETE CASCADE;


--
-- Name: email_thread_links email_thread_links_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_thread_links
    ADD CONSTRAINT email_thread_links_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: email_thread_links email_thread_links_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_thread_links
    ADD CONSTRAINT email_thread_links_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: email_thread_links email_thread_links_outreach_contact_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_thread_links
    ADD CONSTRAINT email_thread_links_outreach_contact_id_fkey FOREIGN KEY (outreach_contact_id) REFERENCES public.outreach_contacts(id) ON DELETE CASCADE;


--
-- Name: email_thread_links email_thread_links_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.email_thread_links
    ADD CONSTRAINT email_thread_links_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.synced_email_threads(id) ON DELETE CASCADE;


--
-- Name: enrichment_jobs enrichment_jobs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_jobs
    ADD CONSTRAINT enrichment_jobs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: enrichment_results enrichment_results_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enrichment_results
    ADD CONSTRAINT enrichment_results_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.enrichment_jobs(id) ON DELETE CASCADE;


--
-- Name: form_templates form_templates_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_templates
    ADD CONSTRAINT form_templates_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE SET NULL;


--
-- Name: form_templates form_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.form_templates
    ADD CONSTRAINT form_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: foundation_profiles foundation_profiles_foundation_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.foundation_profiles
    ADD CONSTRAINT foundation_profiles_foundation_id_fkey FOREIGN KEY (foundation_id) REFERENCES public.foundation_directory(id) ON DELETE CASCADE;


--
-- Name: fundability_deficiencies fundability_deficiencies_fundability_score_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundability_deficiencies
    ADD CONSTRAINT fundability_deficiencies_fundability_score_id_fkey FOREIGN KEY (fundability_score_id) REFERENCES public.fundability_scores(id) ON DELETE CASCADE;


--
-- Name: fundability_scores fundability_scores_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundability_scores
    ADD CONSTRAINT fundability_scores_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: fundability_scores fundability_scores_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.fundability_scores
    ADD CONSTRAINT fundability_scores_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: funder_credentials funder_credentials_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_credentials
    ADD CONSTRAINT funder_credentials_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: funder_credentials funder_credentials_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_credentials
    ADD CONSTRAINT funder_credentials_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: funder_dna_profiles funder_dna_profiles_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_dna_profiles
    ADD CONSTRAINT funder_dna_profiles_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: funder_dna_profiles funder_dna_profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_dna_profiles
    ADD CONSTRAINT funder_dna_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: funder_giving_history funder_giving_history_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_giving_history
    ADD CONSTRAINT funder_giving_history_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: funder_giving_history funder_giving_history_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_giving_history
    ADD CONSTRAINT funder_giving_history_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: funder_intelligence funder_intelligence_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_intelligence
    ADD CONSTRAINT funder_intelligence_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: funder_intelligence funder_intelligence_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_intelligence
    ADD CONSTRAINT funder_intelligence_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: funder_relationship_events funder_relationship_events_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_relationship_events
    ADD CONSTRAINT funder_relationship_events_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: funder_relationship_events funder_relationship_events_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_relationship_events
    ADD CONSTRAINT funder_relationship_events_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: funder_relationship_scores funder_relationship_scores_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_relationship_scores
    ADD CONSTRAINT funder_relationship_scores_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: funder_relationship_scores funder_relationship_scores_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_relationship_scores
    ADD CONSTRAINT funder_relationship_scores_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: funder_relationship_signals funder_relationship_signals_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_relationship_signals
    ADD CONSTRAINT funder_relationship_signals_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: funder_relationship_signals funder_relationship_signals_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funder_relationship_signals
    ADD CONSTRAINT funder_relationship_signals_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: funders funders_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.funders
    ADD CONSTRAINT funders_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: grant_agreements grant_agreements_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_agreements
    ADD CONSTRAINT grant_agreements_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id);


--
-- Name: grant_agreements grant_agreements_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_agreements
    ADD CONSTRAINT grant_agreements_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: grant_agreements grant_agreements_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_agreements
    ADD CONSTRAINT grant_agreements_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.autoapply_submissions(id);


--
-- Name: grant_budgets grant_budgets_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_budgets
    ADD CONSTRAINT grant_budgets_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: grant_budgets grant_budgets_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_budgets
    ADD CONSTRAINT grant_budgets_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: grant_expenses grant_expenses_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_expenses
    ADD CONSTRAINT grant_expenses_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: grant_expenses grant_expenses_budget_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_expenses
    ADD CONSTRAINT grant_expenses_budget_id_fkey FOREIGN KEY (budget_id) REFERENCES public.grant_budgets(id) ON DELETE CASCADE;


--
-- Name: grant_expenses grant_expenses_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_expenses
    ADD CONSTRAINT grant_expenses_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: grant_reconciliation_reports grant_reconciliation_reports_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_reconciliation_reports
    ADD CONSTRAINT grant_reconciliation_reports_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: grant_reconciliation_reports grant_reconciliation_reports_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.grant_reconciliation_reports
    ADD CONSTRAINT grant_reconciliation_reports_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: historical_awards historical_awards_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.historical_awards
    ADD CONSTRAINT historical_awards_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: impersonation_log impersonation_log_admin_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_log
    ADD CONSTRAINT impersonation_log_admin_id_fkey FOREIGN KEY (admin_id) REFERENCES public.platform_admins(id);


--
-- Name: impersonation_log impersonation_log_target_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.impersonation_log
    ADD CONSTRAINT impersonation_log_target_org_id_fkey FOREIGN KEY (target_org_id) REFERENCES public.organizations(id);


--
-- Name: improvement_proposals improvement_proposals_reviewed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.improvement_proposals
    ADD CONSTRAINT improvement_proposals_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES public.profiles(id);


--
-- Name: integration_keys integration_keys_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integration_keys
    ADD CONSTRAINT integration_keys_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: integrations integrations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.integrations
    ADD CONSTRAINT integrations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: intelligence_grant_dna_scores intelligence_grant_dna_scores_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_grant_dna_scores
    ADD CONSTRAINT intelligence_grant_dna_scores_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.intelligence_funded_proposals(id) ON DELETE CASCADE;


--
-- Name: intelligence_grantmaker_profiles intelligence_grantmaker_profiles_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_grantmaker_profiles
    ADD CONSTRAINT intelligence_grantmaker_profiles_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id);


--
-- Name: intelligence_proposal_sections intelligence_proposal_sections_proposal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.intelligence_proposal_sections
    ADD CONSTRAINT intelligence_proposal_sections_proposal_id_fkey FOREIGN KEY (proposal_id) REFERENCES public.intelligence_funded_proposals(id) ON DELETE CASCADE;


--
-- Name: invoices invoices_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: kb_extended_needs kb_extended_needs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_extended_needs
    ADD CONSTRAINT kb_extended_needs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: kb_extended_needs kb_extended_needs_request_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.kb_extended_needs
    ADD CONSTRAINT kb_extended_needs_request_profile_id_fkey FOREIGN KEY (request_profile_id) REFERENCES public.request_profiles(id) ON DELETE CASCADE;


--
-- Name: knowledge_base knowledge_base_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_base
    ADD CONSTRAINT knowledge_base_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: knowledge_base knowledge_base_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.knowledge_base
    ADD CONSTRAINT knowledge_base_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: marketplace_listings marketplace_listings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_listings
    ADD CONSTRAINT marketplace_listings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: marketplace_matches marketplace_matches_listing_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_matches
    ADD CONSTRAINT marketplace_matches_listing_id_fkey FOREIGN KEY (listing_id) REFERENCES public.marketplace_listings(id) ON DELETE CASCADE;


--
-- Name: marketplace_matches marketplace_matches_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.marketplace_matches
    ADD CONSTRAINT marketplace_matches_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: notes notes_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: notes notes_author_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id);


--
-- Name: notes notes_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE CASCADE;


--
-- Name: notes notes_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: notes notes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notes
    ADD CONSTRAINT notes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: onboarding_steps onboarding_steps_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.onboarding_steps
    ADD CONSTRAINT onboarding_steps_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: opportunities opportunities_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE SET NULL;


--
-- Name: opportunities opportunities_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunities
    ADD CONSTRAINT opportunities_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: opportunity_keywords opportunity_keywords_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_keywords
    ADD CONSTRAINT opportunity_keywords_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: opportunity_keywords opportunity_keywords_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.opportunity_keywords
    ADD CONSTRAINT opportunity_keywords_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: org_autonomous_config org_autonomous_config_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_autonomous_config
    ADD CONSTRAINT org_autonomous_config_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_documents org_documents_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_documents
    ADD CONSTRAINT org_documents_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_learning_contributions org_learning_contributions_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_learning_contributions
    ADD CONSTRAINT org_learning_contributions_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_learning_contributions org_learning_contributions_pattern_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_learning_contributions
    ADD CONSTRAINT org_learning_contributions_pattern_id_fkey FOREIGN KEY (pattern_id) REFERENCES public.platform_learning_patterns(id);


--
-- Name: org_settings org_settings_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_settings
    ADD CONSTRAINT org_settings_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: org_usage_summary org_usage_summary_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.org_usage_summary
    ADD CONSTRAINT org_usage_summary_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: outcomes outcomes_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcomes
    ADD CONSTRAINT outcomes_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id);


--
-- Name: outcomes outcomes_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcomes
    ADD CONSTRAINT outcomes_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: outcomes outcomes_recorded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outcomes
    ADD CONSTRAINT outcomes_recorded_by_fkey FOREIGN KEY (recorded_by) REFERENCES public.profiles(id);


--
-- Name: outreach_contacts outreach_contacts_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_contacts
    ADD CONSTRAINT outreach_contacts_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.email_campaigns(id);


--
-- Name: outreach_contacts outreach_contacts_converted_to_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_contacts
    ADD CONSTRAINT outreach_contacts_converted_to_funder_id_fkey FOREIGN KEY (converted_to_funder_id) REFERENCES public.funders(id);


--
-- Name: outreach_contacts outreach_contacts_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_contacts
    ADD CONSTRAINT outreach_contacts_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: outreach_template_variants outreach_template_variants_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_template_variants
    ADD CONSTRAINT outreach_template_variants_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: outreach_template_variants outreach_template_variants_template_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_template_variants
    ADD CONSTRAINT outreach_template_variants_template_id_fkey FOREIGN KEY (template_id) REFERENCES public.outreach_templates(id) ON DELETE CASCADE;


--
-- Name: outreach_templates outreach_templates_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.outreach_templates
    ADD CONSTRAINT outreach_templates_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: pig_edges pig_edges_source_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pig_edges
    ADD CONSTRAINT pig_edges_source_node_id_fkey FOREIGN KEY (source_node_id) REFERENCES public.pig_nodes(id) ON DELETE CASCADE;


--
-- Name: pig_edges pig_edges_target_node_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pig_edges
    ADD CONSTRAINT pig_edges_target_node_id_fkey FOREIGN KEY (target_node_id) REFERENCES public.pig_nodes(id) ON DELETE CASCADE;


--
-- Name: pipeline_history pipeline_history_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_history
    ADD CONSTRAINT pipeline_history_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: pipeline_history pipeline_history_changed_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_history
    ADD CONSTRAINT pipeline_history_changed_by_fkey FOREIGN KEY (changed_by) REFERENCES public.profiles(id);


--
-- Name: pipeline_history pipeline_history_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pipeline_history
    ADD CONSTRAINT pipeline_history_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: pitch_cache pitch_cache_request_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pitch_cache
    ADD CONSTRAINT pitch_cache_request_profile_id_fkey FOREIGN KEY (request_profile_id) REFERENCES public.request_profiles(id) ON DELETE SET NULL;


--
-- Name: platform_admins platform_admins_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.platform_admins(id);


--
-- Name: platform_admins platform_admins_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_admins
    ADD CONSTRAINT platform_admins_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: platform_config platform_config_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_config
    ADD CONSTRAINT platform_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: platform_tasks platform_tasks_assigned_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_tasks
    ADD CONSTRAINT platform_tasks_assigned_by_fkey FOREIGN KEY (assigned_by) REFERENCES public.platform_admins(id);


--
-- Name: platform_tasks platform_tasks_assigned_to_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_tasks
    ADD CONSTRAINT platform_tasks_assigned_to_fkey FOREIGN KEY (assigned_to) REFERENCES public.platform_admins(id);


--
-- Name: platform_tasks platform_tasks_related_tenant_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.platform_tasks
    ADD CONSTRAINT platform_tasks_related_tenant_id_fkey FOREIGN KEY (related_tenant_id) REFERENCES public.organizations(id);


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id) ON DELETE CASCADE;


--
-- Name: profiles profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.profiles
    ADD CONSTRAINT profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: programs programs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.programs
    ADD CONSTRAINT programs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: prospects prospects_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.prospects
    ADD CONSTRAINT prospects_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.prospect_lists(id) ON DELETE CASCADE;


--
-- Name: proven_narratives proven_narratives_knowledge_base_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proven_narratives
    ADD CONSTRAINT proven_narratives_knowledge_base_id_fkey FOREIGN KEY (knowledge_base_id) REFERENCES public.knowledge_base(id);


--
-- Name: proven_narratives proven_narratives_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proven_narratives
    ADD CONSTRAINT proven_narratives_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: proven_narratives proven_narratives_outcome_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.proven_narratives
    ADD CONSTRAINT proven_narratives_outcome_id_fkey FOREIGN KEY (outcome_id) REFERENCES public.outcomes(id);


--
-- Name: relationship_memory relationship_memory_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationship_memory
    ADD CONSTRAINT relationship_memory_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: relationship_recommendations relationship_recommendations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.relationship_recommendations
    ADD CONSTRAINT relationship_recommendations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: renewals renewals_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renewals
    ADD CONSTRAINT renewals_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: renewals renewals_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renewals
    ADD CONSTRAINT renewals_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id);


--
-- Name: renewals renewals_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renewals
    ADD CONSTRAINT renewals_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id);


--
-- Name: renewals renewals_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.renewals
    ADD CONSTRAINT renewals_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: reputation_alerts reputation_alerts_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reputation_alerts
    ADD CONSTRAINT reputation_alerts_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: reputation_alerts reputation_alerts_signal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.reputation_alerts
    ADD CONSTRAINT reputation_alerts_signal_id_fkey FOREIGN KEY (signal_id) REFERENCES public.reputation_signals(id);


--
-- Name: request_profiles request_profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.request_profiles
    ADD CONSTRAINT request_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: research_cache research_cache_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.research_cache
    ADD CONSTRAINT research_cache_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: roi_insights roi_insights_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roi_insights
    ADD CONSTRAINT roi_insights_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: sales_campaign_steps sales_campaign_steps_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_campaign_steps
    ADD CONSTRAINT sales_campaign_steps_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.sales_campaigns(id) ON DELETE CASCADE;


--
-- Name: sales_campaigns sales_campaigns_list_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_campaigns
    ADD CONSTRAINT sales_campaigns_list_id_fkey FOREIGN KEY (list_id) REFERENCES public.prospect_lists(id);


--
-- Name: sales_sends sales_sends_campaign_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_sends
    ADD CONSTRAINT sales_sends_campaign_id_fkey FOREIGN KEY (campaign_id) REFERENCES public.sales_campaigns(id);


--
-- Name: sales_sends sales_sends_prospect_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_sends
    ADD CONSTRAINT sales_sends_prospect_id_fkey FOREIGN KEY (prospect_id) REFERENCES public.prospects(id);


--
-- Name: sales_sends sales_sends_sending_domain_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_sends
    ADD CONSTRAINT sales_sends_sending_domain_id_fkey FOREIGN KEY (sending_domain_id) REFERENCES public.sending_domains(id);


--
-- Name: sales_sends sales_sends_step_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.sales_sends
    ADD CONSTRAINT sales_sends_step_id_fkey FOREIGN KEY (step_id) REFERENCES public.sales_campaign_steps(id);


--
-- Name: scrape_results scrape_results_job_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scrape_results
    ADD CONSTRAINT scrape_results_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.scrape_jobs(id);


--
-- Name: scraping_targets scraping_targets_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.scraping_targets
    ADD CONSTRAINT scraping_targets_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: search_profiles search_profiles_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.search_profiles
    ADD CONSTRAINT search_profiles_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: simulation_scenarios simulation_scenarios_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.simulation_scenarios
    ADD CONSTRAINT simulation_scenarios_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: solicitation_registrations solicitation_registrations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.solicitation_registrations
    ADD CONSTRAINT solicitation_registrations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: strategic_recommendations strategic_recommendations_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.strategic_recommendations
    ADD CONSTRAINT strategic_recommendations_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: submission_queue submission_queue_funder_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_queue
    ADD CONSTRAINT submission_queue_funder_id_fkey FOREIGN KEY (funder_id) REFERENCES public.funders(id) ON DELETE SET NULL;


--
-- Name: submission_queue submission_queue_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_queue
    ADD CONSTRAINT submission_queue_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: submission_queue submission_queue_request_profile_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_queue
    ADD CONSTRAINT submission_queue_request_profile_id_fkey FOREIGN KEY (request_profile_id) REFERENCES public.request_profiles(id);


--
-- Name: submission_queue submission_queue_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_queue
    ADD CONSTRAINT submission_queue_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.autoapply_submissions(id) ON DELETE SET NULL;


--
-- Name: submission_receipts submission_receipts_submission_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_receipts
    ADD CONSTRAINT submission_receipts_submission_id_fkey FOREIGN KEY (submission_id) REFERENCES public.autoapply_submissions(id) ON DELETE CASCADE;


--
-- Name: submission_variables submission_variables_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_variables
    ADD CONSTRAINT submission_variables_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id) ON DELETE CASCADE;


--
-- Name: submission_variables submission_variables_org_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submission_variables
    ADD CONSTRAINT submission_variables_org_id_fkey FOREIGN KEY (org_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: subscriptions subscriptions_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.subscriptions
    ADD CONSTRAINT subscriptions_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: success_probability_scores success_probability_scores_application_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.success_probability_scores
    ADD CONSTRAINT success_probability_scores_application_id_fkey FOREIGN KEY (application_id) REFERENCES public.applications(id);


--
-- Name: success_probability_scores success_probability_scores_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.success_probability_scores
    ADD CONSTRAINT success_probability_scores_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: synced_email_messages synced_email_messages_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_email_messages
    ADD CONSTRAINT synced_email_messages_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: synced_email_messages synced_email_messages_thread_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_email_messages
    ADD CONSTRAINT synced_email_messages_thread_id_fkey FOREIGN KEY (thread_id) REFERENCES public.synced_email_threads(id) ON DELETE CASCADE;


--
-- Name: synced_email_threads synced_email_threads_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.synced_email_threads
    ADD CONSTRAINT synced_email_threads_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: system_errors system_errors_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_errors
    ADD CONSTRAINT system_errors_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: system_errors system_errors_resolved_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_errors
    ADD CONSTRAINT system_errors_resolved_by_fkey FOREIGN KEY (resolved_by) REFERENCES public.platform_admins(id);


--
-- Name: team_activity_log team_activity_log_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_activity_log
    ADD CONSTRAINT team_activity_log_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: team_activity_log team_activity_log_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.team_activity_log
    ADD CONSTRAINT team_activity_log_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id);


--
-- Name: usage_metrics usage_metrics_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_metrics
    ADD CONSTRAINT usage_metrics_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: usage_tracking usage_tracking_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.usage_tracking
    ADD CONSTRAINT usage_tracking_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: user_invitations user_invitations_accepted_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invitations
    ADD CONSTRAINT user_invitations_accepted_by_fkey FOREIGN KEY (accepted_by) REFERENCES public.profiles(id);


--
-- Name: user_invitations user_invitations_invited_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invitations
    ADD CONSTRAINT user_invitations_invited_by_fkey FOREIGN KEY (invited_by) REFERENCES public.profiles(id);


--
-- Name: user_invitations user_invitations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.user_invitations
    ADD CONSTRAINT user_invitations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: validations validations_created_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validations
    ADD CONSTRAINT validations_created_by_fkey FOREIGN KEY (created_by) REFERENCES public.profiles(id);


--
-- Name: validations validations_opportunity_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validations
    ADD CONSTRAINT validations_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES public.opportunities(id) ON DELETE CASCADE;


--
-- Name: validations validations_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.validations
    ADD CONSTRAINT validations_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: webhook_configs webhook_configs_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.webhook_configs
    ADD CONSTRAINT webhook_configs_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id) ON DELETE CASCADE;


--
-- Name: worker_status worker_status_current_item_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.worker_status
    ADD CONSTRAINT worker_status_current_item_id_fkey FOREIGN KEY (current_item_id) REFERENCES public.submission_queue(id);


--
-- Name: objects objects_bucketId_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.objects
    ADD CONSTRAINT "objects_bucketId_fkey" FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads s3_multipart_uploads_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads
    ADD CONSTRAINT s3_multipart_uploads_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets(id);


--
-- Name: s3_multipart_uploads_parts s3_multipart_uploads_parts_upload_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.s3_multipart_uploads_parts
    ADD CONSTRAINT s3_multipart_uploads_parts_upload_id_fkey FOREIGN KEY (upload_id) REFERENCES storage.s3_multipart_uploads(id) ON DELETE CASCADE;


--
-- Name: vector_indexes vector_indexes_bucket_id_fkey; Type: FK CONSTRAINT; Schema: storage; Owner: -
--

ALTER TABLE ONLY storage.vector_indexes
    ADD CONSTRAINT vector_indexes_bucket_id_fkey FOREIGN KEY (bucket_id) REFERENCES storage.buckets_vectors(id);


--
-- Name: audit_log_entries; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.audit_log_entries ENABLE ROW LEVEL SECURITY;

--
-- Name: flow_state; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.flow_state ENABLE ROW LEVEL SECURITY;

--
-- Name: identities; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.identities ENABLE ROW LEVEL SECURITY;

--
-- Name: instances; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.instances ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_amr_claims; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_amr_claims ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_challenges; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_challenges ENABLE ROW LEVEL SECURITY;

--
-- Name: mfa_factors; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.mfa_factors ENABLE ROW LEVEL SECURITY;

--
-- Name: one_time_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.one_time_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: refresh_tokens; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.refresh_tokens ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: saml_relay_states; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.saml_relay_states ENABLE ROW LEVEL SECURITY;

--
-- Name: schema_migrations; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.schema_migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: sessions; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_domains; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: sso_providers; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.sso_providers ENABLE ROW LEVEL SECURITY;

--
-- Name: users; Type: ROW SECURITY; Schema: auth; Owner: -
--

ALTER TABLE auth.users ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_screenshots Users can insert own session screenshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own session screenshots" ON public.automation_screenshots FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.automation_sessions s
  WHERE ((s.id = automation_screenshots.session_id) AND (s.organization_id = ( SELECT profiles.organization_id
           FROM public.profiles
          WHERE (profiles.id = auth.uid())))))));


--
-- Name: automation_steps Users can insert own session steps; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can insert own session steps" ON public.automation_steps FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM public.automation_sessions s
  WHERE ((s.id = automation_steps.session_id) AND (s.organization_id = ( SELECT profiles.organization_id
           FROM public.profiles
          WHERE (profiles.id = auth.uid())))))));


--
-- Name: automation_screenshots Users can read own session screenshots; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own session screenshots" ON public.automation_screenshots FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.automation_sessions s
  WHERE ((s.id = automation_screenshots.session_id) AND (s.organization_id = ( SELECT profiles.organization_id
           FROM public.profiles
          WHERE (profiles.id = auth.uid())))))));


--
-- Name: automation_steps Users can read own session steps; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY "Users can read own session steps" ON public.automation_steps FOR SELECT USING ((EXISTS ( SELECT 1
   FROM public.automation_sessions s
  WHERE ((s.id = automation_steps.session_id) AND (s.organization_id = ( SELECT profiles.organization_id
           FROM public.profiles
          WHERE (profiles.id = auth.uid())))))));


--
-- Name: adapter_usage_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.adapter_usage_log ENABLE ROW LEVEL SECURITY;

--
-- Name: adapter_usage_log adapter_usage_log_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY adapter_usage_log_org_insert ON public.adapter_usage_log FOR INSERT TO authenticated WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: adapter_usage_log adapter_usage_log_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY adapter_usage_log_org_select ON public.adapter_usage_log FOR SELECT TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: strategic_recommendations advisor_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY advisor_org ON public.strategic_recommendations USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: agent_configurations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_configurations ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_configurations agent_configurations_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_configurations_org ON public.agent_configurations USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: agent_decisions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_decisions ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_performance_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_performance_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_registry agent_registry_shared_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_registry_shared_select ON public.agent_registry FOR SELECT TO authenticated USING (true);


--
-- Name: agent_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.agent_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: agent_runs agent_runs_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY agent_runs_org_isolation ON public.agent_runs USING ((organization_id = public.current_org_id()));


--
-- Name: ai_usage_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.ai_usage_log ENABLE ROW LEVEL SECURITY;

--
-- Name: alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: alerts alerts_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY alerts_org_isolation ON public.alerts USING ((organization_id = public.current_org_id()));


--
-- Name: application_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.application_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: application_documents application_documents_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY application_documents_org_isolation ON public.application_documents USING ((application_id IN ( SELECT applications.id
   FROM public.applications
  WHERE (applications.organization_id = public.current_org_id()))));


--
-- Name: applications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.applications ENABLE ROW LEVEL SECURITY;

--
-- Name: applications applications_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY applications_org_isolation ON public.applications USING ((organization_id = public.current_org_id()));


--
-- Name: audit_logs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

--
-- Name: audit_logs audit_logs_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY audit_logs_org_isolation ON public.audit_logs USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: org_autonomous_config auto_config_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auto_config_org ON public.org_autonomous_config USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: auto_queue_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.auto_queue_config ENABLE ROW LEVEL SECURITY;

--
-- Name: auto_queue_config auto_queue_config_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auto_queue_config_org_insert ON public.auto_queue_config FOR INSERT TO authenticated WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: auto_queue_config auto_queue_config_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auto_queue_config_org_select ON public.auto_queue_config FOR SELECT TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: auto_queue_config auto_queue_config_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY auto_queue_config_org_update ON public.auto_queue_config FOR UPDATE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autoapply_confirmation_ambiguous_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.autoapply_confirmation_ambiguous_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: autoapply_confirmation_processed_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.autoapply_confirmation_processed_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: autoapply_follow_ups; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.autoapply_follow_ups ENABLE ROW LEVEL SECURITY;

--
-- Name: autoapply_follow_ups autoapply_follow_ups_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_follow_ups_org_insert ON public.autoapply_follow_ups FOR INSERT WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autoapply_follow_ups autoapply_follow_ups_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_follow_ups_org_select ON public.autoapply_follow_ups FOR SELECT USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autoapply_follow_ups autoapply_follow_ups_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_follow_ups_org_update ON public.autoapply_follow_ups FOR UPDATE USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autoapply_review_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.autoapply_review_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: autoapply_review_queue autoapply_review_queue_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_review_queue_org_insert ON public.autoapply_review_queue FOR INSERT TO authenticated WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autoapply_review_queue autoapply_review_queue_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_review_queue_org_select ON public.autoapply_review_queue FOR SELECT TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autoapply_review_queue autoapply_review_queue_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_review_queue_org_update ON public.autoapply_review_queue FOR UPDATE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autoapply_screenshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.autoapply_screenshots ENABLE ROW LEVEL SECURITY;

--
-- Name: autoapply_screenshots autoapply_screenshots_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_screenshots_org_insert ON public.autoapply_screenshots FOR INSERT TO authenticated WITH CHECK (((submission_id IS NULL) OR (EXISTS ( SELECT 1
   FROM public.autoapply_submissions s
  WHERE ((s.id = autoapply_screenshots.submission_id) AND (s.organization_id = ( SELECT profiles.organization_id
           FROM public.profiles
          WHERE (profiles.id = auth.uid()))))))));


--
-- Name: autoapply_screenshots autoapply_screenshots_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_screenshots_org_select ON public.autoapply_screenshots FOR SELECT TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.autoapply_submissions s
  WHERE ((s.id = autoapply_screenshots.submission_id) AND (s.organization_id = ( SELECT profiles.organization_id
           FROM public.profiles
          WHERE (profiles.id = auth.uid())))))));


--
-- Name: autoapply_screenshots autoapply_screenshots_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_screenshots_org_update ON public.autoapply_screenshots FOR UPDATE TO authenticated USING ((EXISTS ( SELECT 1
   FROM public.autoapply_submissions s
  WHERE ((s.id = autoapply_screenshots.submission_id) AND (s.organization_id = ( SELECT profiles.organization_id
           FROM public.profiles
          WHERE (profiles.id = auth.uid())))))));


--
-- Name: autoapply_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.autoapply_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: autoapply_submissions autoapply_submissions_org_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_submissions_org_delete ON public.autoapply_submissions FOR DELETE USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autoapply_submissions autoapply_submissions_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_submissions_org_insert ON public.autoapply_submissions FOR INSERT WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autoapply_submissions autoapply_submissions_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_submissions_org_select ON public.autoapply_submissions FOR SELECT USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autoapply_submissions autoapply_submissions_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY autoapply_submissions_org_update ON public.autoapply_submissions FOR UPDATE USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: automation_notifications; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_notifications ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_notifications automation_notifications_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automation_notifications_org_isolation ON public.automation_notifications USING ((organization_id = public.current_org_id()));


--
-- Name: automation_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_queue automation_queue_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automation_queue_org_isolation ON public.automation_queue USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: automation_screenshots; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_screenshots ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_sessions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_sessions ENABLE ROW LEVEL SECURITY;

--
-- Name: automation_sessions automation_sessions_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY automation_sessions_org_isolation ON public.automation_sessions USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: automation_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.automation_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: autonomous_triggers; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.autonomous_triggers ENABLE ROW LEVEL SECURITY;

--
-- Name: board_meeting_packets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_meeting_packets ENABLE ROW LEVEL SECURITY;

--
-- Name: board_meetings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_meetings ENABLE ROW LEVEL SECURITY;

--
-- Name: board_meetings board_meetings_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_meetings_org ON public.board_meetings USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: board_members; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.board_members ENABLE ROW LEVEL SECURITY;

--
-- Name: board_members board_members_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_members_org_isolation ON public.board_members USING ((organization_id = public.current_org_id()));


--
-- Name: board_meeting_packets board_packets_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY board_packets_org ON public.board_meeting_packets USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: calendar_connections cal_conn_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cal_conn_org ON public.calendar_connections USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: calendar_events cal_events_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cal_events_org ON public.calendar_events USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: calendar_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: calendar_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.calendar_events ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_sends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_sends campaign_sends_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY campaign_sends_org_isolation ON public.campaign_sends USING ((campaign_step_id IN ( SELECT cs.id
   FROM (public.campaign_steps cs
     JOIN public.email_campaigns ec ON ((ec.id = cs.campaign_id)))
  WHERE (ec.organization_id = public.current_org_id()))));


--
-- Name: campaign_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.campaign_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: campaign_steps campaign_steps_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY campaign_steps_org_isolation ON public.campaign_steps USING ((campaign_id IN ( SELECT email_campaigns.id
   FROM public.email_campaigns
  WHERE (email_campaigns.organization_id = public.current_org_id()))));


--
-- Name: community_need_signals cnp_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY cnp_org ON public.community_need_signals USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: community_foundation_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_foundation_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: community_need_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.community_need_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: competitor_tracking competitor_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY competitor_org_isolation ON public.competitor_tracking USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: competitor_tracking; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.competitor_tracking ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.compliance_events ENABLE ROW LEVEL SECURITY;

--
-- Name: compliance_events compliance_events_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY compliance_events_org ON public.compliance_events USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: contact_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contact_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: contact_tasks contact_tasks_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contact_tasks_org_isolation ON public.contact_tasks USING ((organization_id = public.current_org_id())) WITH CHECK ((organization_id = public.current_org_id()));


--
-- Name: contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: contacts contacts_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY contacts_org_isolation ON public.contacts USING ((organization_id = public.current_org_id()));


--
-- Name: corporate_relationships corp_rel_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY corp_rel_org ON public.corporate_relationships USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: corporate_giving_targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_giving_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_intent_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_intent_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_monitoring_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_monitoring_events ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_prospects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_prospects ENABLE ROW LEVEL SECURITY;

--
-- Name: corporate_relationships; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.corporate_relationships ENABLE ROW LEVEL SECURITY;

--
-- Name: cross_client_submissions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.cross_client_submissions ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_api_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_api_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_api_connections custom_api_connections_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY custom_api_connections_org_isolation ON public.custom_api_connections USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: custom_connector_allowlist; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.custom_connector_allowlist ENABLE ROW LEVEL SECURITY;

--
-- Name: custom_connector_allowlist custom_connector_allowlist_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY custom_connector_allowlist_org_isolation ON public.custom_connector_allowlist TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: dd_api_spend; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dd_api_spend ENABLE ROW LEVEL SECURITY;

--
-- Name: dd_prospect_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dd_prospect_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: dd_prospect_requests dd_prospect_requests_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY dd_prospect_requests_org_isolation ON public.dd_prospect_requests USING ((EXISTS ( SELECT 1
   FROM public.donor_discovery_prospects p
  WHERE ((p.id = dd_prospect_requests.prospect_id) AND (p.organization_id = public.current_org_id())))));


--
-- Name: dd_robots_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.dd_robots_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: deadlines; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.deadlines ENABLE ROW LEVEL SECURITY;

--
-- Name: deadlines deadlines_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY deadlines_org_isolation ON public.deadlines USING ((organization_id = public.current_org_id()));


--
-- Name: agent_decisions decisions_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY decisions_org ON public.agent_decisions USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: disaster_declarations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.disaster_declarations ENABLE ROW LEVEL SECURITY;

--
-- Name: disaster_declarations disaster_declarations_authenticated_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY disaster_declarations_authenticated_select ON public.disaster_declarations FOR SELECT TO authenticated USING (true);


--
-- Name: disaster_emergency_funds; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.disaster_emergency_funds ENABLE ROW LEVEL SECURITY;

--
-- Name: disaster_emergency_funds disaster_emergency_funds_authenticated_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY disaster_emergency_funds_authenticated_select ON public.disaster_emergency_funds FOR SELECT TO authenticated USING (true);


--
-- Name: discovery_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discovery_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: discovery_matches discovery_matches_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discovery_matches_org_insert ON public.discovery_matches FOR INSERT TO authenticated WITH CHECK ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: discovery_matches discovery_matches_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discovery_matches_org_select ON public.discovery_matches FOR SELECT TO authenticated USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: discovery_matches discovery_matches_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY discovery_matches_org_update ON public.discovery_matches FOR UPDATE TO authenticated USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: discovery_runs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.discovery_runs ENABLE ROW LEVEL SECURITY;

--
-- Name: documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;

--
-- Name: documents documents_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY documents_org_isolation ON public.documents USING ((organization_id = public.current_org_id()));


--
-- Name: donor_discovery_connectors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donor_discovery_connectors ENABLE ROW LEVEL SECURITY;

--
-- Name: donor_discovery_connectors donor_discovery_connectors_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY donor_discovery_connectors_org_isolation ON public.donor_discovery_connectors USING ((organization_id = public.current_org_id()));


--
-- Name: donor_discovery_directory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donor_discovery_directory ENABLE ROW LEVEL SECURITY;

--
-- Name: donor_discovery_directory donor_discovery_directory_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY donor_discovery_directory_authenticated_read ON public.donor_discovery_directory FOR SELECT TO authenticated USING (true);


--
-- Name: donor_discovery_geocache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donor_discovery_geocache ENABLE ROW LEVEL SECURITY;

--
-- Name: donor_discovery_prospects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donor_discovery_prospects ENABLE ROW LEVEL SECURITY;

--
-- Name: donor_discovery_prospects donor_discovery_prospects_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY donor_discovery_prospects_org_isolation ON public.donor_discovery_prospects USING ((organization_id = public.current_org_id()));


--
-- Name: donor_discovery_requests; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donor_discovery_requests ENABLE ROW LEVEL SECURITY;

--
-- Name: donor_discovery_requests donor_discovery_requests_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY donor_discovery_requests_org_isolation ON public.donor_discovery_requests USING ((organization_id = public.current_org_id()));


--
-- Name: donor_discovery_taxonomy; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donor_discovery_taxonomy ENABLE ROW LEVEL SECURITY;

--
-- Name: donor_discovery_taxonomy_aliases; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donor_discovery_taxonomy_aliases ENABLE ROW LEVEL SECURITY;

--
-- Name: donor_discovery_taxonomy donor_discovery_taxonomy_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY donor_discovery_taxonomy_authenticated_read ON public.donor_discovery_taxonomy FOR SELECT TO authenticated USING (true);


--
-- Name: donor_discovery_tos_registry; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.donor_discovery_tos_registry ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_automation_config draft_auto_config_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY draft_auto_config_org ON public.draft_automation_config USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: draft_automation_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.draft_automation_config ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.draft_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_queue draft_queue_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY draft_queue_org ON public.draft_queue USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: draft_versions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.draft_versions ENABLE ROW LEVEL SECURITY;

--
-- Name: draft_versions draft_versions_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY draft_versions_org_isolation ON public.draft_versions USING ((organization_id = public.current_org_id()));


--
-- Name: email_activity; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_activity ENABLE ROW LEVEL SECURITY;

--
-- Name: email_activity email_activity_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_activity_org_isolation ON public.email_activity USING ((organization_id = public.current_org_id()));


--
-- Name: email_campaign_sequences; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_campaign_sequences ENABLE ROW LEVEL SECURITY;

--
-- Name: email_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: email_campaigns email_campaigns_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_campaigns_org_isolation ON public.email_campaigns USING ((organization_id = public.current_org_id()));


--
-- Name: email_connections email_conn_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_conn_org ON public.email_connections USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: email_connections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_connections ENABLE ROW LEVEL SECURITY;

--
-- Name: email_sequence_enrollments email_enrollments_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_enrollments_org ON public.email_sequence_enrollments USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: email_sequence_steps email_seq_steps_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_seq_steps_org ON public.email_sequence_steps USING ((sequence_id IN ( SELECT email_campaign_sequences.id
   FROM public.email_campaign_sequences
  WHERE (email_campaign_sequences.organization_id = ( SELECT profiles.organization_id
           FROM public.profiles
          WHERE (profiles.id = auth.uid()))))));


--
-- Name: email_sequence_enrollments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_sequence_enrollments ENABLE ROW LEVEL SECURITY;

--
-- Name: email_sequence_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_sequence_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: email_campaign_sequences email_sequences_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_sequences_org ON public.email_campaign_sequences USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: email_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: email_templates email_templates_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_templates_org ON public.email_templates USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: email_thread_links; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.email_thread_links ENABLE ROW LEVEL SECURITY;

--
-- Name: email_thread_links email_thread_links_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY email_thread_links_org_isolation ON public.email_thread_links USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: enrichment_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrichment_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: enrichment_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.enrichment_results ENABLE ROW LEVEL SECURITY;

--
-- Name: enrichment_results enrichment_results_shared_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY enrichment_results_shared_select ON public.enrichment_results FOR SELECT TO authenticated USING (true);


--
-- Name: funding_forecasts forecasts_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY forecasts_org ON public.funding_forecasts USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: form_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.form_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: form_templates form_templates_org_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY form_templates_org_delete ON public.form_templates FOR DELETE USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: form_templates form_templates_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY form_templates_org_insert ON public.form_templates FOR INSERT WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: form_templates form_templates_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY form_templates_org_select ON public.form_templates FOR SELECT USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: form_templates form_templates_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY form_templates_org_update ON public.form_templates FOR UPDATE USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: foundation_directory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.foundation_directory ENABLE ROW LEVEL SECURITY;

--
-- Name: foundation_directory foundation_directory_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY foundation_directory_authenticated_read ON public.foundation_directory FOR SELECT TO authenticated USING (true);


--
-- Name: foundation_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.foundation_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: foundation_profiles foundation_profiles_shared_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY foundation_profiles_shared_insert ON public.foundation_profiles FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: foundation_profiles foundation_profiles_shared_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY foundation_profiles_shared_select ON public.foundation_profiles FOR SELECT TO authenticated USING (true);


--
-- Name: foundation_profiles foundation_profiles_shared_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY foundation_profiles_shared_update ON public.foundation_profiles FOR UPDATE TO authenticated USING (true);


--
-- Name: fundability_deficiencies; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fundability_deficiencies ENABLE ROW LEVEL SECURITY;

--
-- Name: fundability_scores fundability_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY fundability_org ON public.fundability_scores USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: fundability_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.fundability_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: funder_credentials; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funder_credentials ENABLE ROW LEVEL SECURITY;

--
-- Name: funder_credentials funder_credentials_org_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_credentials_org_delete ON public.funder_credentials FOR DELETE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: funder_credentials funder_credentials_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_credentials_org_insert ON public.funder_credentials FOR INSERT TO authenticated WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: funder_credentials funder_credentials_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_credentials_org_select ON public.funder_credentials FOR SELECT TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: funder_credentials funder_credentials_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_credentials_org_update ON public.funder_credentials FOR UPDATE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: funder_dna_profiles funder_dna_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_dna_org ON public.funder_dna_profiles USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: funder_dna_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funder_dna_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: funder_giving_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funder_giving_history ENABLE ROW LEVEL SECURITY;

--
-- Name: funder_giving_history funder_giving_history_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_giving_history_org_isolation ON public.funder_giving_history USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: funder_intelligence; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funder_intelligence ENABLE ROW LEVEL SECURITY;

--
-- Name: funder_intelligence funder_intelligence_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_intelligence_org_isolation ON public.funder_intelligence USING ((organization_id = public.current_org_id()));


--
-- Name: funder_relationship_scores funder_rel_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_rel_org_isolation ON public.funder_relationship_scores USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: funder_relationship_events; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funder_relationship_events ENABLE ROW LEVEL SECURITY;

--
-- Name: funder_relationship_events funder_relationship_events_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_relationship_events_org ON public.funder_relationship_events USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: funder_relationship_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funder_relationship_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: funder_relationship_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funder_relationship_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: funder_relationship_signals funder_relationship_signals_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funder_relationship_signals_org ON public.funder_relationship_signals USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: funders; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funders ENABLE ROW LEVEL SECURITY;

--
-- Name: funders funders_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY funders_org_isolation ON public.funders USING ((organization_id = public.current_org_id()));


--
-- Name: funding_forecasts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.funding_forecasts ENABLE ROW LEVEL SECURITY;

--
-- Name: grant_agreements; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grant_agreements ENABLE ROW LEVEL SECURITY;

--
-- Name: grant_agreements grant_agreements_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY grant_agreements_org_insert ON public.grant_agreements FOR INSERT TO authenticated WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: grant_agreements grant_agreements_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY grant_agreements_org_select ON public.grant_agreements FOR SELECT TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: grant_agreements grant_agreements_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY grant_agreements_org_update ON public.grant_agreements FOR UPDATE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: grant_budgets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grant_budgets ENABLE ROW LEVEL SECURITY;

--
-- Name: grant_budgets grant_budgets_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY grant_budgets_org ON public.grant_budgets USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: grant_expenses; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grant_expenses ENABLE ROW LEVEL SECURITY;

--
-- Name: grant_expenses grant_expenses_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY grant_expenses_org ON public.grant_expenses USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: grant_reconciliation_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.grant_reconciliation_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: grant_reconciliation_reports grant_reconciliation_reports_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY grant_reconciliation_reports_org ON public.grant_reconciliation_reports USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: historical_awards; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.historical_awards ENABLE ROW LEVEL SECURITY;

--
-- Name: historical_awards historical_awards_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY historical_awards_org_isolation ON public.historical_awards USING ((organization_id = public.current_org_id()));


--
-- Name: impact_simulations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.impact_simulations ENABLE ROW LEVEL SECURITY;

--
-- Name: impersonation_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.impersonation_log ENABLE ROW LEVEL SECURITY;

--
-- Name: improvement_proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.improvement_proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_keys; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integration_keys ENABLE ROW LEVEL SECURITY;

--
-- Name: integration_keys integration_keys_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY integration_keys_org_isolation ON public.integration_keys USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: integrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.integrations ENABLE ROW LEVEL SECURITY;

--
-- Name: integrations integrations_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY integrations_org_isolation ON public.integrations USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: intelligence_budget_patterns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_budget_patterns ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_budget_patterns intelligence_budget_patterns_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intelligence_budget_patterns_authenticated_read ON public.intelligence_budget_patterns FOR SELECT TO authenticated USING (true);


--
-- Name: intelligence_budget_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_budget_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_evaluation_frameworks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_evaluation_frameworks ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_evaluation_frameworks intelligence_evaluation_frameworks_shared_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intelligence_evaluation_frameworks_shared_select ON public.intelligence_evaluation_frameworks FOR SELECT TO authenticated USING (true);


--
-- Name: intelligence_funded_proposals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_funded_proposals ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_funded_proposals intelligence_funded_proposals_authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intelligence_funded_proposals_authenticated_insert ON public.intelligence_funded_proposals FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: intelligence_funded_proposals intelligence_funded_proposals_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intelligence_funded_proposals_authenticated_read ON public.intelligence_funded_proposals FOR SELECT TO authenticated USING (true);


--
-- Name: intelligence_grant_dna_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_grant_dna_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_grantmaker_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_grantmaker_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_grantmaker_profiles intelligence_grantmaker_profiles_shared_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intelligence_grantmaker_profiles_shared_select ON public.intelligence_grantmaker_profiles FOR SELECT TO authenticated USING (true);


--
-- Name: intelligence_logic_models; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_logic_models ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_logic_models intelligence_logic_models_shared_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intelligence_logic_models_shared_select ON public.intelligence_logic_models FOR SELECT TO authenticated USING (true);


--
-- Name: intelligence_narrative_patterns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_narrative_patterns ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_need_data; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_need_data ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_need_data intelligence_need_data_shared_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intelligence_need_data_shared_select ON public.intelligence_need_data FOR SELECT TO authenticated USING (true);


--
-- Name: intelligence_post_award_reports; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_post_award_reports ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_proposal_sections; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_proposal_sections ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_proposal_sections intelligence_proposal_sections_authenticated_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intelligence_proposal_sections_authenticated_insert ON public.intelligence_proposal_sections FOR INSERT TO authenticated WITH CHECK (true);


--
-- Name: intelligence_proposal_sections intelligence_proposal_sections_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intelligence_proposal_sections_authenticated_read ON public.intelligence_proposal_sections FOR SELECT TO authenticated USING (true);


--
-- Name: intelligence_scoring_rubrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.intelligence_scoring_rubrics ENABLE ROW LEVEL SECURITY;

--
-- Name: intelligence_scoring_rubrics intelligence_scoring_rubrics_shared_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intelligence_scoring_rubrics_shared_select ON public.intelligence_scoring_rubrics FOR SELECT TO authenticated USING (true);


--
-- Name: corporate_intent_signals intent_signals_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY intent_signals_org ON public.corporate_intent_signals USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: invoices; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

--
-- Name: invoices invoices_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY invoices_org_isolation ON public.invoices USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: kb_extended_needs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.kb_extended_needs ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_base; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_base ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_base knowledge_base_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_base_org_isolation ON public.knowledge_base USING ((organization_id = public.current_org_id()));


--
-- Name: knowledge_patterns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_patterns ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_patterns knowledge_patterns_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_patterns_authenticated_read ON public.knowledge_patterns FOR SELECT TO authenticated USING (true);


--
-- Name: knowledge_queries; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.knowledge_queries ENABLE ROW LEVEL SECURITY;

--
-- Name: knowledge_queries knowledge_queries_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_queries_org_insert ON public.knowledge_queries FOR INSERT TO authenticated WITH CHECK ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: knowledge_queries knowledge_queries_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY knowledge_queries_org_select ON public.knowledge_queries FOR SELECT TO authenticated USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: marketplace_listings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_listings marketplace_listings_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_listings_org_insert ON public.marketplace_listings FOR INSERT TO authenticated WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: marketplace_listings marketplace_listings_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_listings_org_select ON public.marketplace_listings FOR SELECT TO authenticated USING (((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR public.marketplace_org_has_match_on_listing(id, ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: marketplace_listings marketplace_listings_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_listings_org_update ON public.marketplace_listings FOR UPDATE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: marketplace_matches; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.marketplace_matches ENABLE ROW LEVEL SECURITY;

--
-- Name: marketplace_matches marketplace_matches_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_matches_org_insert ON public.marketplace_matches FOR INSERT TO authenticated WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: marketplace_matches marketplace_matches_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_matches_org_select ON public.marketplace_matches FOR SELECT TO authenticated USING (((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR public.marketplace_listing_owned_by_org(listing_id, ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: marketplace_matches marketplace_matches_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY marketplace_matches_org_update ON public.marketplace_matches FOR UPDATE TO authenticated USING (((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR public.marketplace_listing_owned_by_org(listing_id, ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))))) WITH CHECK (((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))) OR public.marketplace_listing_owned_by_org(listing_id, ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: corporate_monitoring_events monitoring_events_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY monitoring_events_authenticated ON public.corporate_monitoring_events USING ((auth.role() = 'authenticated'::text));


--
-- Name: nonprofits; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.nonprofits ENABLE ROW LEVEL SECURITY;

--
-- Name: nonprofits nonprofits_authenticated_read; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY nonprofits_authenticated_read ON public.nonprofits FOR SELECT TO authenticated USING (true);


--
-- Name: notes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

--
-- Name: notes notes_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY notes_org_isolation ON public.notes USING ((organization_id = public.current_org_id()));


--
-- Name: onboarding_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.onboarding_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: onboarding_steps onboarding_steps_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY onboarding_steps_org_isolation ON public.onboarding_steps USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: opportunities; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunities ENABLE ROW LEVEL SECURITY;

--
-- Name: opportunities opportunities_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opportunities_org_isolation ON public.opportunities USING ((organization_id = public.current_org_id()));


--
-- Name: opportunity_keywords; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunity_keywords ENABLE ROW LEVEL SECURITY;

--
-- Name: opportunity_keywords opportunity_keywords_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opportunity_keywords_org_isolation ON public.opportunity_keywords USING ((organization_id = public.current_org_id()));


--
-- Name: opportunity_probability_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.opportunity_probability_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: opportunity_probability_scores opportunity_probability_scores_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY opportunity_probability_scores_org_isolation ON public.opportunity_probability_scores TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: org_autonomous_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_autonomous_config ENABLE ROW LEVEL SECURITY;

--
-- Name: org_documents; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_documents ENABLE ROW LEVEL SECURITY;

--
-- Name: org_documents org_documents_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_documents_org_isolation ON public.org_documents FOR SELECT TO authenticated USING ((organization_id = public.current_org_id()));


--
-- Name: renewals org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_isolation ON public.renewals USING ((organization_id = public.current_org_id()));


--
-- Name: org_learning_contributions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_learning_contributions ENABLE ROW LEVEL SECURITY;

--
-- Name: org_learning_contributions org_learning_contributions_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_learning_contributions_org_select ON public.org_learning_contributions FOR SELECT TO authenticated USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: org_settings; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_settings ENABLE ROW LEVEL SECURITY;

--
-- Name: org_settings org_settings_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_settings_org_insert ON public.org_settings FOR INSERT WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: org_settings org_settings_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_settings_org_select ON public.org_settings FOR SELECT USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: org_settings org_settings_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_settings_org_update ON public.org_settings FOR UPDATE USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: org_usage_summary org_usage_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY org_usage_org ON public.org_usage_summary USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: org_usage_summary; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.org_usage_summary ENABLE ROW LEVEL SECURITY;

--
-- Name: organizational_digital_twins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizational_digital_twins ENABLE ROW LEVEL SECURITY;

--
-- Name: organizational_digital_twins organizational_digital_twins_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizational_digital_twins_org_isolation ON public.organizational_digital_twins TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: organizations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

--
-- Name: organizations organizations_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY organizations_org_isolation ON public.organizations USING ((id = public.current_org_id()));


--
-- Name: outcomes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outcomes ENABLE ROW LEVEL SECURITY;

--
-- Name: outcomes outcomes_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outcomes_org_isolation ON public.outcomes USING ((organization_id = public.current_org_id()));


--
-- Name: outreach_contacts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_contacts ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_contacts outreach_contacts_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_contacts_org_isolation ON public.outreach_contacts USING ((organization_id = public.current_org_id()));


--
-- Name: outreach_template_variants; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_template_variants ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_template_variants outreach_template_variants_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_template_variants_org ON public.outreach_template_variants TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: outreach_templates; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.outreach_templates ENABLE ROW LEVEL SECURITY;

--
-- Name: outreach_templates outreach_templates_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY outreach_templates_org ON public.outreach_templates TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))) WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: pig_edges; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pig_edges ENABLE ROW LEVEL SECURITY;

--
-- Name: pig_edges pig_edges_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pig_edges_authenticated ON public.pig_edges USING ((auth.role() = 'authenticated'::text));


--
-- Name: pig_nodes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pig_nodes ENABLE ROW LEVEL SECURITY;

--
-- Name: pig_nodes pig_nodes_authenticated; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pig_nodes_authenticated ON public.pig_nodes USING ((auth.role() = 'authenticated'::text));


--
-- Name: pipeline_history; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pipeline_history ENABLE ROW LEVEL SECURITY;

--
-- Name: pipeline_history pipeline_history_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pipeline_history_org_isolation ON public.pipeline_history USING ((organization_id = public.current_org_id()));


--
-- Name: pitch_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.pitch_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: pitch_cache pitch_cache_org_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pitch_cache_org_delete ON public.pitch_cache FOR DELETE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: pitch_cache pitch_cache_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pitch_cache_org_insert ON public.pitch_cache FOR INSERT TO authenticated WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: pitch_cache pitch_cache_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pitch_cache_org_select ON public.pitch_cache FOR SELECT TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: pitch_cache pitch_cache_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY pitch_cache_org_update ON public.pitch_cache FOR UPDATE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: platform_admins; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_config; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_config ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_config platform_config_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_config_org_isolation ON public.platform_config USING ((organization_id = public.current_org_id()));


--
-- Name: platform_learning_patterns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_learning_patterns ENABLE ROW LEVEL SECURITY;

--
-- Name: platform_learning_patterns platform_learning_patterns_shared_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY platform_learning_patterns_shared_select ON public.platform_learning_patterns FOR SELECT TO authenticated USING (true);


--
-- Name: platform_tasks; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.platform_tasks ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: profiles profiles_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY profiles_org_isolation ON public.profiles USING (((id = auth.uid()) OR (organization_id = public.current_org_id())));


--
-- Name: programs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.programs ENABLE ROW LEVEL SECURITY;

--
-- Name: programs programs_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY programs_org_isolation ON public.programs USING ((organization_id = public.current_org_id()));


--
-- Name: prospect_lists; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospect_lists ENABLE ROW LEVEL SECURITY;

--
-- Name: prospects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.prospects ENABLE ROW LEVEL SECURITY;

--
-- Name: proven_narratives; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.proven_narratives ENABLE ROW LEVEL SECURITY;

--
-- Name: proven_narratives proven_narratives_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY proven_narratives_org_isolation ON public.proven_narratives USING ((organization_id = public.current_org_id()));


--
-- Name: agent_queue queue_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY queue_org ON public.agent_queue USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: relationship_memory; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.relationship_memory ENABLE ROW LEVEL SECURITY;

--
-- Name: relationship_memory relationship_memory_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY relationship_memory_org ON public.relationship_memory USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: relationship_recommendations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.relationship_recommendations ENABLE ROW LEVEL SECURITY;

--
-- Name: relationship_recommendations relationship_recommendations_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY relationship_recommendations_org ON public.relationship_recommendations USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: renewals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.renewals ENABLE ROW LEVEL SECURITY;

--
-- Name: reputation_alerts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reputation_alerts ENABLE ROW LEVEL SECURITY;

--
-- Name: reputation_alerts reputation_alerts_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY reputation_alerts_org ON public.reputation_alerts USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: reputation_signals; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.reputation_signals ENABLE ROW LEVEL SECURITY;

--
-- Name: request_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.request_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: request_profiles request_profiles_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY request_profiles_org_isolation ON public.request_profiles FOR SELECT TO authenticated USING ((organization_id = public.current_org_id()));


--
-- Name: research_cache; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.research_cache ENABLE ROW LEVEL SECURITY;

--
-- Name: research_cache research_cache_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY research_cache_org_isolation ON public.research_cache USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: roi_insights; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.roi_insights ENABLE ROW LEVEL SECURITY;

--
-- Name: roi_insights roi_insights_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY roi_insights_org ON public.roi_insights USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: sales_campaign_steps; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_campaign_steps ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_campaigns; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_campaigns ENABLE ROW LEVEL SECURITY;

--
-- Name: sales_sends; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sales_sends ENABLE ROW LEVEL SECURITY;

--
-- Name: scrape_jobs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scrape_jobs ENABLE ROW LEVEL SECURITY;

--
-- Name: scrape_results; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scrape_results ENABLE ROW LEVEL SECURITY;

--
-- Name: scraping_targets; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.scraping_targets ENABLE ROW LEVEL SECURITY;

--
-- Name: scraping_targets scraping_targets_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY scraping_targets_org_isolation ON public.scraping_targets USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: search_profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.search_profiles ENABLE ROW LEVEL SECURITY;

--
-- Name: search_profiles search_profiles_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY search_profiles_org_isolation ON public.search_profiles USING ((organization_id = public.current_org_id()));


--
-- Name: sending_domains; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.sending_domains ENABLE ROW LEVEL SECURITY;

--
-- Name: donor_discovery_taxonomy_aliases service_role_all; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY service_role_all ON public.donor_discovery_taxonomy_aliases TO service_role USING (true) WITH CHECK (true);


--
-- Name: simulation_scenarios sim_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sim_org ON public.simulation_scenarios USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: simulation_scenarios; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.simulation_scenarios ENABLE ROW LEVEL SECURITY;

--
-- Name: impact_simulations simulations_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY simulations_org ON public.impact_simulations USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: solicitation_registrations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.solicitation_registrations ENABLE ROW LEVEL SECURITY;

--
-- Name: solicitation_registrations solicitation_registrations_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY solicitation_registrations_org_insert ON public.solicitation_registrations FOR INSERT TO authenticated WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: solicitation_registrations solicitation_registrations_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY solicitation_registrations_org_select ON public.solicitation_registrations FOR SELECT TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: solicitation_registrations solicitation_registrations_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY solicitation_registrations_org_update ON public.solicitation_registrations FOR UPDATE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: strategic_recommendations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.strategic_recommendations ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_variables sub_vars_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY sub_vars_org ON public.submission_variables USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: submission_queue; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.submission_queue ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_queue submission_queue_org_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY submission_queue_org_delete ON public.submission_queue FOR DELETE USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: submission_queue submission_queue_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY submission_queue_org_insert ON public.submission_queue FOR INSERT WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: submission_queue submission_queue_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY submission_queue_org_select ON public.submission_queue FOR SELECT USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: submission_queue submission_queue_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY submission_queue_org_update ON public.submission_queue FOR UPDATE USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: submission_receipts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.submission_receipts ENABLE ROW LEVEL SECURITY;

--
-- Name: submission_receipts submission_receipts_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY submission_receipts_org_select ON public.submission_receipts FOR SELECT TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: submission_variables; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.submission_variables ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

--
-- Name: subscriptions subscriptions_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY subscriptions_org_isolation ON public.subscriptions USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: success_probability_scores success_prob_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY success_prob_org_isolation ON public.success_probability_scores USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: success_probability_scores; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.success_probability_scores ENABLE ROW LEVEL SECURITY;

--
-- Name: suppression_list; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.suppression_list ENABLE ROW LEVEL SECURITY;

--
-- Name: synced_email_messages; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.synced_email_messages ENABLE ROW LEVEL SECURITY;

--
-- Name: synced_email_messages synced_email_messages_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY synced_email_messages_org_isolation ON public.synced_email_messages USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: synced_email_threads; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.synced_email_threads ENABLE ROW LEVEL SECURITY;

--
-- Name: synced_email_threads synced_email_threads_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY synced_email_threads_org_isolation ON public.synced_email_threads USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: system_errors; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.system_errors ENABLE ROW LEVEL SECURITY;

--
-- Name: team_activity_log; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.team_activity_log ENABLE ROW LEVEL SECURITY;

--
-- Name: team_activity_log team_activity_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY team_activity_org ON public.team_activity_log USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: autonomous_triggers triggers_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY triggers_org ON public.autonomous_triggers USING ((org_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: usage_metrics; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_metrics ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_metrics usage_metrics_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usage_metrics_org_isolation ON public.usage_metrics USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: usage_tracking; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.usage_tracking ENABLE ROW LEVEL SECURITY;

--
-- Name: usage_tracking usage_tracking_insert_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usage_tracking_insert_own_org ON public.usage_tracking FOR INSERT WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: usage_tracking usage_tracking_select_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usage_tracking_select_own_org ON public.usage_tracking FOR SELECT USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: usage_tracking usage_tracking_update_own_org; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY usage_tracking_update_own_org ON public.usage_tracking FOR UPDATE USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: user_invitations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.user_invitations ENABLE ROW LEVEL SECURITY;

--
-- Name: user_invitations user_invitations_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY user_invitations_org_isolation ON public.user_invitations USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: validations; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.validations ENABLE ROW LEVEL SECURITY;

--
-- Name: validations validations_org_isolation; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY validations_org_isolation ON public.validations USING ((organization_id = public.current_org_id()));


--
-- Name: webhook_configs; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.webhook_configs ENABLE ROW LEVEL SECURITY;

--
-- Name: webhook_configs webhook_configs_org_delete; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_configs_org_delete ON public.webhook_configs FOR DELETE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: webhook_configs webhook_configs_org_insert; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_configs_org_insert ON public.webhook_configs FOR INSERT TO authenticated WITH CHECK ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: webhook_configs webhook_configs_org_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_configs_org_select ON public.webhook_configs FOR SELECT TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: webhook_configs webhook_configs_org_update; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY webhook_configs_org_update ON public.webhook_configs FOR UPDATE TO authenticated USING ((organization_id = ( SELECT profiles.organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid()))));


--
-- Name: worker_status; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE public.worker_status ENABLE ROW LEVEL SECURITY;

--
-- Name: worker_status worker_status_shared_select; Type: POLICY; Schema: public; Owner: -
--

CREATE POLICY worker_status_shared_select ON public.worker_status FOR SELECT TO authenticated USING (true);


--
-- Name: messages; Type: ROW SECURITY; Schema: realtime; Owner: -
--

ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

--
-- Name: objects autoapply_screenshots_org_scoped_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY autoapply_screenshots_org_scoped_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'autoapply-screenshots'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects autoapply_screenshots_org_scoped_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY autoapply_screenshots_org_scoped_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'autoapply-screenshots'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects autoapply_screenshots_org_scoped_select; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY autoapply_screenshots_org_scoped_select ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'autoapply-screenshots'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects autoapply_screenshots_org_scoped_update; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY autoapply_screenshots_org_scoped_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'autoapply-screenshots'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: buckets; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_analytics; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_analytics ENABLE ROW LEVEL SECURITY;

--
-- Name: buckets_vectors; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.buckets_vectors ENABLE ROW LEVEL SECURITY;

--
-- Name: objects documents_org_scoped_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY documents_org_scoped_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects documents_org_scoped_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY documents_org_scoped_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects documents_org_scoped_select; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY documents_org_scoped_select ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects documents_org_scoped_update; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY documents_org_scoped_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: migrations; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.migrations ENABLE ROW LEVEL SECURITY;

--
-- Name: objects nofa_pdfs_authenticated_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY nofa_pdfs_authenticated_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'nofa-pdfs'::text));


--
-- Name: objects nofa_pdfs_authenticated_update; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY nofa_pdfs_authenticated_update ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'nofa-pdfs'::text));


--
-- Name: objects nofa_pdfs_public_read; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY nofa_pdfs_public_read ON storage.objects FOR SELECT USING ((bucket_id = 'nofa-pdfs'::text));


--
-- Name: objects; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

--
-- Name: objects org_branding_authenticated_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_branding_authenticated_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = 'org-branding'::text));


--
-- Name: objects org_branding_authenticated_update; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_branding_authenticated_update ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = 'org-branding'::text));


--
-- Name: objects org_branding_public_read; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_branding_public_read ON storage.objects FOR SELECT USING ((bucket_id = 'org-branding'::text));


--
-- Name: objects org_bucket_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_bucket_delete ON storage.objects FOR DELETE TO authenticated USING ((bucket_id = ('org-'::text || ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects org_bucket_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_bucket_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK ((bucket_id = ('org-'::text || ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects org_bucket_select; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_bucket_select ON storage.objects FOR SELECT TO authenticated USING ((bucket_id = ('org-'::text || ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects org_bucket_update; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_bucket_update ON storage.objects FOR UPDATE TO authenticated USING ((bucket_id = ('org-'::text || ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects org_documents_org_scoped_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_documents_org_scoped_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'org-documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects org_documents_org_scoped_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_documents_org_scoped_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'org-documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects org_documents_org_scoped_select; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_documents_org_scoped_select ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'org-documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects org_documents_org_scoped_update; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY org_documents_org_scoped_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'org-documents'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: s3_multipart_uploads; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads ENABLE ROW LEVEL SECURITY;

--
-- Name: s3_multipart_uploads_parts; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.s3_multipart_uploads_parts ENABLE ROW LEVEL SECURITY;

--
-- Name: objects session_recordings_org_scoped_delete; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY session_recordings_org_scoped_delete ON storage.objects FOR DELETE TO authenticated USING (((bucket_id = 'session-recordings'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects session_recordings_org_scoped_insert; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY session_recordings_org_scoped_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (((bucket_id = 'session-recordings'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects session_recordings_org_scoped_select; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY session_recordings_org_scoped_select ON storage.objects FOR SELECT TO authenticated USING (((bucket_id = 'session-recordings'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: objects session_recordings_org_scoped_update; Type: POLICY; Schema: storage; Owner: -
--

CREATE POLICY session_recordings_org_scoped_update ON storage.objects FOR UPDATE TO authenticated USING (((bucket_id = 'session-recordings'::text) AND ((storage.foldername(name))[1] = ( SELECT (profiles.organization_id)::text AS organization_id
   FROM public.profiles
  WHERE (profiles.id = auth.uid())))));


--
-- Name: vector_indexes; Type: ROW SECURITY; Schema: storage; Owner: -
--

ALTER TABLE storage.vector_indexes ENABLE ROW LEVEL SECURITY;

--
-- Name: supabase_realtime; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime_messages_publication; Type: PUBLICATION; Schema: -; Owner: -
--

CREATE PUBLICATION supabase_realtime_messages_publication WITH (publish = 'insert, update, delete, truncate');


--
-- Name: supabase_realtime_messages_publication messages; Type: PUBLICATION TABLE; Schema: realtime; Owner: -
--

ALTER PUBLICATION supabase_realtime_messages_publication ADD TABLE ONLY realtime.messages;


--
-- Name: issue_graphql_placeholder; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_graphql_placeholder ON sql_drop
         WHEN TAG IN ('DROP EXTENSION')
   EXECUTE FUNCTION extensions.set_graphql_placeholder();


--
-- Name: issue_pg_cron_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_cron_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_cron_access();


--
-- Name: issue_pg_graphql_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_graphql_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_graphql_access();


--
-- Name: issue_pg_net_access; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER issue_pg_net_access ON ddl_command_end
         WHEN TAG IN ('CREATE EXTENSION')
   EXECUTE FUNCTION extensions.grant_pg_net_access();


--
-- Name: pgrst_ddl_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_ddl_watch ON ddl_command_end
   EXECUTE FUNCTION extensions.pgrst_ddl_watch();


--
-- Name: pgrst_drop_watch; Type: EVENT TRIGGER; Schema: -; Owner: -
--

CREATE EVENT TRIGGER pgrst_drop_watch ON sql_drop
   EXECUTE FUNCTION extensions.pgrst_drop_watch();


--
-- PostgreSQL database dump complete
--

\unrestrict DtNjR4CZPwGhgI3zk4EKCB1R4FKCwCRZLnhtRLrdNNIh6CPJLytUf8Ztlde9mbo

