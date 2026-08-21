-- WGR-130/131 production verification, migration 141's trigger.
-- Disposable org+application, wrapped in BEGIN;...ROLLBACK; -- nothing is
-- committed to production by this script regardless of outcome. Uses a
-- fresh, throwaway org rather than touching real customer rows (unlike the
-- branch-verify script, which mutated real production application rows and
-- is not safe to re-run here).
BEGIN;

DO $$
DECLARE
  test_org_id uuid;
  test_opp_id uuid;
  legal_app_id uuid;
  illegal_app_id uuid;
  legal_stage_after public.pipeline_stage;
  illegal_stage_after public.pipeline_stage;
  illegal_rejected boolean := false;
BEGIN
  INSERT INTO organizations (name, onboarding_progress)
  VALUES ('WGR130_131_PROD_VERIFY_TMP', '{}')
  RETURNING id INTO test_org_id;

  INSERT INTO opportunities (organization_id, name, category)
  VALUES (test_org_id, 'WGR130_131_PROD_VERIFY_TMP_OPP', 'private_foundation')
  RETURNING id INTO test_opp_id;

  INSERT INTO applications (organization_id, opportunity_id, stage)
  VALUES (test_org_id, test_opp_id, 'discovered')
  RETURNING id INTO legal_app_id;

  INSERT INTO applications (organization_id, opportunity_id, stage)
  VALUES (test_org_id, test_opp_id, 'discovered')
  RETURNING id INTO illegal_app_id;

  -- 1. Legal transition: discovered -> eligibility_review (real next stage).
  UPDATE applications SET stage = 'eligibility_review' WHERE id = legal_app_id;
  SELECT stage INTO legal_stage_after FROM applications WHERE id = legal_app_id;

  -- 2. Illegal skip: discovered -> awarded (WGR-131's exact repro shape).
  BEGIN
    UPDATE applications SET stage = 'awarded' WHERE id = illegal_app_id;
  EXCEPTION WHEN OTHERS THEN
    illegal_rejected := true;
    RAISE NOTICE 'illegal transition correctly rejected: %', SQLERRM;
  END;
  SELECT stage INTO illegal_stage_after FROM applications WHERE id = illegal_app_id;

  RAISE NOTICE 'RESULT legal_transition_persisted=% illegal_transition_rejected=% illegal_stage_unchanged=%',
    (legal_stage_after = 'eligibility_review'),
    illegal_rejected,
    (illegal_stage_after = 'discovered');
END $$;

ROLLBACK;
