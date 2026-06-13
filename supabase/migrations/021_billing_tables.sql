-- ============================================================
-- 021_billing_tables.sql
-- Phase 5 — Extend the subscription_tier enum for Consultant plan.
--
-- The subscriptions and invoices tables were created in 002_phases_2_5.sql.
-- This migration only adds the new tier values so the Stripe webhook handler
-- can write "consultant" to subscriptions.tier without a type violation.
--
-- organizations.subscription_tier is a text column (001_initial_schema.sql),
-- so "consultant" and "suspended" already work there without a migration.
-- ============================================================

ALTER TYPE subscription_tier ADD VALUE IF NOT EXISTS 'consultant';
