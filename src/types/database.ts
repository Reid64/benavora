// Database types for Benavora - hand-authored to mirror SCHEMA_REGISTRY.md v1.0.
//
// Shape matches Supabase's generated output (public.Tables.<name>.{Row,Insert,Update},
// public.Enums) so it can be swapped for real generated types after Migration 001:
//   pnpm dlx supabase gen types typescript --project-id <ref> > src/types/database.ts
//
// Conventions:
//   - uuid / text / date / timestamptz  -> string
//   - numeric / integer / bigint        -> number
//   - boolean                           -> boolean
//   - jsonb                             -> Json
//   - NOT NULL columns are required & non-null in Row; nullable columns are `| null`.
//   - Insert: NOT NULL columns without a default are required; everything else optional.
//   - Update: every column optional.

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export interface Database {
  public: {
    Tables: {
      organizations: {
        Row: {
          id: string;
          name: string;
          dba: string | null;
          ein: string | null;
          tax_status: string | null;
          mission_statement: string | null;
          vision_statement: string | null;
          founding_date: string | null;
          founder_name: string | null;
          founder_bio: string | null;
          service_area: string | null;
          target_population: string | null;
          annual_budget: number | null;
          total_staff: number | null;
          total_volunteers: number | null;
          website: string | null;
          phone: string | null;
          email: string | null;
          address_line1: string | null;
          address_line2: string | null;
          city: string | null;
          state: string | null;
          zip: string | null;
          logo_url: string | null;
          stripe_customer_id: string | null;
          subscription_tier: string | null;
          onboarding_completed: boolean;
          onboarding_completed_at: string | null;
          onboarding_step: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          dba?: string | null;
          ein?: string | null;
          tax_status?: string | null;
          mission_statement?: string | null;
          vision_statement?: string | null;
          founding_date?: string | null;
          founder_name?: string | null;
          founder_bio?: string | null;
          service_area?: string | null;
          target_population?: string | null;
          annual_budget?: number | null;
          total_staff?: number | null;
          total_volunteers?: number | null;
          website?: string | null;
          phone?: string | null;
          email?: string | null;
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          logo_url?: string | null;
          stripe_customer_id?: string | null;
          subscription_tier?: string | null;
          onboarding_completed?: boolean;
          onboarding_completed_at?: string | null;
          onboarding_step?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          dba?: string | null;
          ein?: string | null;
          tax_status?: string | null;
          mission_statement?: string | null;
          vision_statement?: string | null;
          founding_date?: string | null;
          founder_name?: string | null;
          founder_bio?: string | null;
          service_area?: string | null;
          target_population?: string | null;
          annual_budget?: number | null;
          total_staff?: number | null;
          total_volunteers?: number | null;
          website?: string | null;
          phone?: string | null;
          email?: string | null;
          address_line1?: string | null;
          address_line2?: string | null;
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          logo_url?: string | null;
          stripe_customer_id?: string | null;
          subscription_tier?: string | null;
          onboarding_completed?: boolean;
          onboarding_completed_at?: string | null;
          onboarding_step?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      profiles: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          full_name: string | null;
          role: Database["public"]["Enums"]["user_role"];
          avatar_url: string | null;
          last_login_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          organization_id: string;
          email: string;
          full_name?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          avatar_url?: string | null;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          email?: string;
          full_name?: string | null;
          role?: Database["public"]["Enums"]["user_role"];
          avatar_url?: string | null;
          last_login_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      funders: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          category: Database["public"]["Enums"]["funder_category"];
          description: string | null;
          website: string | null;
          giving_portal_url: string | null;
          portal_login_status: string | null;
          annual_giving_budget: number | null;
          geographic_focus: string | null;
          preferred_application_method: string | null;
          has_giving_page: boolean | null;
          portal_status: string | null;
          portal_last_checked_at: string | null;
          portal_response_time_ms: number | null;
          portal_review_status: string | null;
          automation_level: string | null;
          automation_notes: string | null;
          notes: string | null;
          last_contacted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          category: Database["public"]["Enums"]["funder_category"];
          description?: string | null;
          website?: string | null;
          giving_portal_url?: string | null;
          portal_login_status?: string | null;
          annual_giving_budget?: number | null;
          geographic_focus?: string | null;
          preferred_application_method?: string | null;
          has_giving_page?: boolean | null;
          portal_status?: string | null;
          portal_last_checked_at?: string | null;
          portal_response_time_ms?: number | null;
          portal_review_status?: string | null;
          automation_level?: string | null;
          automation_notes?: string | null;
          notes?: string | null;
          last_contacted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          category?: Database["public"]["Enums"]["funder_category"];
          description?: string | null;
          website?: string | null;
          giving_portal_url?: string | null;
          portal_login_status?: string | null;
          annual_giving_budget?: number | null;
          geographic_focus?: string | null;
          preferred_application_method?: string | null;
          has_giving_page?: boolean | null;
          portal_status?: string | null;
          portal_last_checked_at?: string | null;
          portal_response_time_ms?: number | null;
          portal_review_status?: string | null;
          automation_level?: string | null;
          automation_notes?: string | null;
          notes?: string | null;
          last_contacted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      contacts: {
        Row: {
          id: string;
          organization_id: string;
          funder_id: string;
          name: string;
          title: string | null;
          email: string | null;
          phone: string | null;
          preferred_contact_method: string | null;
          relationship: Database["public"]["Enums"]["contact_relationship"] | null;
          last_contacted_at: string | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          funder_id: string;
          name: string;
          title?: string | null;
          email?: string | null;
          phone?: string | null;
          preferred_contact_method?: string | null;
          relationship?: Database["public"]["Enums"]["contact_relationship"] | null;
          last_contacted_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          funder_id?: string;
          name?: string;
          title?: string | null;
          email?: string | null;
          phone?: string | null;
          preferred_contact_method?: string | null;
          relationship?: Database["public"]["Enums"]["contact_relationship"] | null;
          last_contacted_at?: string | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      opportunities: {
        Row: {
          id: string;
          organization_id: string;
          funder_id: string | null;
          name: string;
          category: Database["public"]["Enums"]["funder_category"];
          description: string | null;
          amount_available: number | null;
          amount_min: number | null;
          amount_max: number | null;
          deadline: string | null;
          url: string | null;
          eligibility_requirements: string | null;
          required_documents: string[] | null;
          application_method: string | null;
          recurrence: string | null;
          geographic_restrictions: string | null;
          opportunity_documents: Json | null;
          eligibility_score: number | null;
          recommendation: string | null;
          recommendation_reasoning: string | null;
          match_percentage: number | null;
          is_high_priority: boolean;
          match_mismatch_reasons: string[] | null;
          status: Database["public"]["Enums"]["opportunity_status"] | null;
          source: string | null;
          source_type:
            | Database["public"]["Enums"]["opportunity_source_type"]
            | null;
          discovered_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          funder_id?: string | null;
          name: string;
          category: Database["public"]["Enums"]["funder_category"];
          description?: string | null;
          amount_available?: number | null;
          amount_min?: number | null;
          amount_max?: number | null;
          deadline?: string | null;
          url?: string | null;
          eligibility_requirements?: string | null;
          required_documents?: string[] | null;
          application_method?: string | null;
          recurrence?: string | null;
          geographic_restrictions?: string | null;
          opportunity_documents?: Json | null;
          eligibility_score?: number | null;
          recommendation?: string | null;
          recommendation_reasoning?: string | null;
          match_percentage?: number | null;
          is_high_priority?: boolean;
          match_mismatch_reasons?: string[] | null;
          status?: Database["public"]["Enums"]["opportunity_status"] | null;
          source?: string | null;
          source_type?:
            | Database["public"]["Enums"]["opportunity_source_type"]
            | null;
          discovered_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          funder_id?: string | null;
          name?: string;
          category?: Database["public"]["Enums"]["funder_category"];
          description?: string | null;
          amount_available?: number | null;
          amount_min?: number | null;
          amount_max?: number | null;
          deadline?: string | null;
          url?: string | null;
          eligibility_requirements?: string | null;
          required_documents?: string[] | null;
          application_method?: string | null;
          recurrence?: string | null;
          geographic_restrictions?: string | null;
          opportunity_documents?: Json | null;
          eligibility_score?: number | null;
          recommendation?: string | null;
          recommendation_reasoning?: string | null;
          match_percentage?: number | null;
          is_high_priority?: boolean;
          match_mismatch_reasons?: string[] | null;
          status?: Database["public"]["Enums"]["opportunity_status"] | null;
          source?: string | null;
          source_type?:
            | Database["public"]["Enums"]["opportunity_source_type"]
            | null;
          discovered_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      opportunity_keywords: {
        Row: {
          id: string;
          organization_id: string;
          opportunity_id: string;
          keyword: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          opportunity_id: string;
          keyword: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          opportunity_id?: string;
          keyword?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      applications: {
        Row: {
          id: string;
          organization_id: string;
          opportunity_id: string;
          stage: Database["public"]["Enums"]["pipeline_stage"];
          assigned_user_id: string | null;
          requested_amount: number | null;
          submitted_at: string | null;
          awarded_amount: number | null;
          draft_content: string | null;
          draft_template_type: Database["public"]["Enums"]["draft_template_type"] | null;
          draft_confidence_score: number | null;
          draft_knowledge_sources: Json | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          opportunity_id: string;
          stage?: Database["public"]["Enums"]["pipeline_stage"];
          assigned_user_id?: string | null;
          requested_amount?: number | null;
          submitted_at?: string | null;
          awarded_amount?: number | null;
          draft_content?: string | null;
          draft_template_type?: Database["public"]["Enums"]["draft_template_type"] | null;
          draft_confidence_score?: number | null;
          draft_knowledge_sources?: Json | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          opportunity_id?: string;
          stage?: Database["public"]["Enums"]["pipeline_stage"];
          assigned_user_id?: string | null;
          requested_amount?: number | null;
          submitted_at?: string | null;
          awarded_amount?: number | null;
          draft_content?: string | null;
          draft_template_type?: Database["public"]["Enums"]["draft_template_type"] | null;
          draft_confidence_score?: number | null;
          draft_knowledge_sources?: Json | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      pipeline_history: {
        Row: {
          id: string;
          organization_id: string;
          application_id: string;
          from_stage: Database["public"]["Enums"]["pipeline_stage"] | null;
          to_stage: Database["public"]["Enums"]["pipeline_stage"];
          changed_by: string | null;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          application_id: string;
          from_stage?: Database["public"]["Enums"]["pipeline_stage"] | null;
          to_stage: Database["public"]["Enums"]["pipeline_stage"];
          changed_by?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          application_id?: string;
          from_stage?: Database["public"]["Enums"]["pipeline_stage"] | null;
          to_stage?: Database["public"]["Enums"]["pipeline_stage"];
          changed_by?: string | null;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          id: string;
          organization_id: string;
          file_name: string;
          storage_path: string;
          file_size: number | null;
          mime_type: string | null;
          category: Database["public"]["Enums"]["document_category"];
          description: string | null;
          expiration_date: string | null;
          uploaded_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          file_name: string;
          storage_path: string;
          file_size?: number | null;
          mime_type?: string | null;
          category: Database["public"]["Enums"]["document_category"];
          description?: string | null;
          expiration_date?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          file_name?: string;
          storage_path?: string;
          file_size?: number | null;
          mime_type?: string | null;
          category?: Database["public"]["Enums"]["document_category"];
          description?: string | null;
          expiration_date?: string | null;
          uploaded_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      application_documents: {
        Row: {
          id: string;
          application_id: string;
          document_id: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          application_id: string;
          document_id: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          application_id?: string;
          document_id?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      knowledge_base: {
        Row: {
          id: string;
          organization_id: string;
          category: Database["public"]["Enums"]["knowledge_base_category"];
          title: string;
          content: string;
          is_proven: boolean | null;
          proven_count: number | null;
          funder_categories: Database["public"]["Enums"]["funder_category"][] | null;
          keywords: string[] | null;
          version: number | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          category: Database["public"]["Enums"]["knowledge_base_category"];
          title: string;
          content: string;
          is_proven?: boolean | null;
          proven_count?: number | null;
          funder_categories?: Database["public"]["Enums"]["funder_category"][] | null;
          keywords?: string[] | null;
          version?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          category?: Database["public"]["Enums"]["knowledge_base_category"];
          title?: string;
          content?: string;
          is_proven?: boolean | null;
          proven_count?: number | null;
          funder_categories?: Database["public"]["Enums"]["funder_category"][] | null;
          keywords?: string[] | null;
          version?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      board_members: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          title: string | null;
          bio: string | null;
          email: string | null;
          phone: string | null;
          start_date: string | null;
          is_active: boolean | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          title?: string | null;
          bio?: string | null;
          email?: string | null;
          phone?: string | null;
          start_date?: string | null;
          is_active?: boolean | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          title?: string | null;
          bio?: string | null;
          email?: string | null;
          phone?: string | null;
          start_date?: string | null;
          is_active?: boolean | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      programs: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          description: string | null;
          budget: number | null;
          beneficiaries_served: number | null;
          start_date: string | null;
          status: string | null;
          impact_metrics: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          description?: string | null;
          budget?: number | null;
          beneficiaries_served?: number | null;
          start_date?: string | null;
          status?: string | null;
          impact_metrics?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          description?: string | null;
          budget?: number | null;
          beneficiaries_served?: number | null;
          start_date?: string | null;
          status?: string | null;
          impact_metrics?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      outcomes: {
        Row: {
          id: string;
          organization_id: string;
          application_id: string;
          result: Database["public"]["Enums"]["outcome_result"];
          awarded_amount: number | null;
          requested_amount: number | null;
          funder_feedback: string | null;
          denial_reason: string | null;
          narrative_snapshot: string | null;
          funder_category: Database["public"]["Enums"]["funder_category"] | null;
          opportunity_category: Database["public"]["Enums"]["funder_category"] | null;
          keywords_used: string[] | null;
          recorded_by: string | null;
          recorded_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          application_id: string;
          result: Database["public"]["Enums"]["outcome_result"];
          awarded_amount?: number | null;
          requested_amount?: number | null;
          funder_feedback?: string | null;
          denial_reason?: string | null;
          narrative_snapshot?: string | null;
          funder_category?: Database["public"]["Enums"]["funder_category"] | null;
          opportunity_category?: Database["public"]["Enums"]["funder_category"] | null;
          keywords_used?: string[] | null;
          recorded_by?: string | null;
          recorded_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          application_id?: string;
          result?: Database["public"]["Enums"]["outcome_result"];
          awarded_amount?: number | null;
          requested_amount?: number | null;
          funder_feedback?: string | null;
          denial_reason?: string | null;
          narrative_snapshot?: string | null;
          funder_category?: Database["public"]["Enums"]["funder_category"] | null;
          opportunity_category?: Database["public"]["Enums"]["funder_category"] | null;
          keywords_used?: string[] | null;
          recorded_by?: string | null;
          recorded_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      proven_narratives: {
        Row: {
          id: string;
          organization_id: string;
          outcome_id: string;
          knowledge_base_id: string | null;
          narrative_text: string;
          section_type: string | null;
          funder_category: Database["public"]["Enums"]["funder_category"] | null;
          success_count: number | null;
          effectiveness_score: number | null;
          last_used_at: string | null;
          /** Winning/losing language patterns from migration 017 pattern analysis. */
          success_patterns: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          outcome_id: string;
          knowledge_base_id?: string | null;
          narrative_text: string;
          section_type?: string | null;
          funder_category?: Database["public"]["Enums"]["funder_category"] | null;
          success_count?: number | null;
          effectiveness_score?: number | null;
          last_used_at?: string | null;
          success_patterns?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          outcome_id?: string;
          knowledge_base_id?: string | null;
          narrative_text?: string;
          section_type?: string | null;
          funder_category?: Database["public"]["Enums"]["funder_category"] | null;
          success_count?: number | null;
          effectiveness_score?: number | null;
          last_used_at?: string | null;
          success_patterns?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      deadlines: {
        Row: {
          id: string;
          organization_id: string;
          application_id: string | null;
          opportunity_id: string | null;
          deadline_type: Database["public"]["Enums"]["deadline_type"];
          due_date: string;
          title: string;
          description: string | null;
          is_completed: boolean | null;
          completed_at: string | null;
          reminder_30d_sent: boolean | null;
          reminder_14d_sent: boolean | null;
          reminder_7d_sent: boolean | null;
          reminder_3d_sent: boolean | null;
          reminder_1d_sent: boolean | null;
          // Phase 4: links this deadline to its Google Calendar event (migration
          // 002). Null until the deadline is synced to the calendar.
          google_calendar_event_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          application_id?: string | null;
          opportunity_id?: string | null;
          deadline_type: Database["public"]["Enums"]["deadline_type"];
          due_date: string;
          title: string;
          description?: string | null;
          is_completed?: boolean | null;
          completed_at?: string | null;
          reminder_30d_sent?: boolean | null;
          reminder_14d_sent?: boolean | null;
          reminder_7d_sent?: boolean | null;
          reminder_3d_sent?: boolean | null;
          reminder_1d_sent?: boolean | null;
          google_calendar_event_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          application_id?: string | null;
          opportunity_id?: string | null;
          deadline_type?: Database["public"]["Enums"]["deadline_type"];
          due_date?: string;
          title?: string;
          description?: string | null;
          is_completed?: boolean | null;
          completed_at?: string | null;
          reminder_30d_sent?: boolean | null;
          reminder_14d_sent?: boolean | null;
          reminder_7d_sent?: boolean | null;
          reminder_3d_sent?: boolean | null;
          reminder_1d_sent?: boolean | null;
          google_calendar_event_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      notes: {
        Row: {
          id: string;
          organization_id: string;
          funder_id: string | null;
          opportunity_id: string | null;
          application_id: string | null;
          content: string;
          author_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          funder_id?: string | null;
          opportunity_id?: string | null;
          application_id?: string | null;
          content: string;
          author_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          funder_id?: string | null;
          opportunity_id?: string | null;
          application_id?: string | null;
          content?: string;
          author_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      search_profiles: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          keywords: string[];
          categories: Database["public"]["Enums"]["funder_category"][] | null;
          geographic_scope: string | null;
          min_amount: number | null;
          max_amount: number | null;
          recurrence_preference: string | null;
          is_active: boolean | null;
          last_run_at: string | null;
          results_count: number | null;
          // Advanced configuration (migration 011). All non-null with defaults.
          source_type_filters: Json;
          focus_areas: Json;
          geographic_scopes: string[];
          eligibility_filters: Json;
          populations_served: string[];
          excluded_categories: Database["public"]["Enums"]["funder_category"][];
          excluded_funders: string[];
          agent_settings: Json;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          keywords: string[];
          categories?: Database["public"]["Enums"]["funder_category"][] | null;
          geographic_scope?: string | null;
          min_amount?: number | null;
          max_amount?: number | null;
          recurrence_preference?: string | null;
          is_active?: boolean | null;
          last_run_at?: string | null;
          results_count?: number | null;
          source_type_filters?: Json;
          focus_areas?: Json;
          geographic_scopes?: string[];
          eligibility_filters?: Json;
          populations_served?: string[];
          excluded_categories?: Database["public"]["Enums"]["funder_category"][];
          excluded_funders?: string[];
          agent_settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          keywords?: string[];
          categories?: Database["public"]["Enums"]["funder_category"][] | null;
          geographic_scope?: string | null;
          min_amount?: number | null;
          max_amount?: number | null;
          recurrence_preference?: string | null;
          is_active?: boolean | null;
          last_run_at?: string | null;
          results_count?: number | null;
          source_type_filters?: Json;
          focus_areas?: Json;
          geographic_scopes?: string[];
          eligibility_filters?: Json;
          populations_served?: string[];
          excluded_categories?: Database["public"]["Enums"]["funder_category"][];
          excluded_funders?: string[];
          agent_settings?: Json;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      outreach_contacts: {
        Row: {
          id: string;
          organization_id: string;
          company_name: string;
          contact_name: string | null;
          email: string | null;
          phone: string | null;
          contact_form_url: string | null;
          source_url: string | null;
          company_type: string | null;
          giving_likelihood: string | null;
          campaign_id: string | null;
          status: string | null;
          converted_to_funder_id: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          company_name: string;
          contact_name?: string | null;
          email?: string | null;
          phone?: string | null;
          contact_form_url?: string | null;
          source_url?: string | null;
          company_type?: string | null;
          giving_likelihood?: string | null;
          campaign_id?: string | null;
          status?: string | null;
          converted_to_funder_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          company_name?: string;
          contact_name?: string | null;
          email?: string | null;
          phone?: string | null;
          contact_form_url?: string | null;
          source_url?: string | null;
          company_type?: string | null;
          giving_likelihood?: string | null;
          campaign_id?: string | null;
          status?: string | null;
          converted_to_funder_id?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      email_campaigns: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          status: Database["public"]["Enums"]["campaign_status"] | null;
          total_steps: number | null;
          total_contacts: number | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          status?: Database["public"]["Enums"]["campaign_status"] | null;
          total_steps?: number | null;
          total_contacts?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          status?: Database["public"]["Enums"]["campaign_status"] | null;
          total_steps?: number | null;
          total_contacts?: number | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      campaign_steps: {
        Row: {
          id: string;
          campaign_id: string;
          step_number: number;
          subject_template: string;
          body_template: string;
          delay_days: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_id: string;
          step_number: number;
          subject_template: string;
          body_template: string;
          delay_days?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_id?: string;
          step_number?: number;
          subject_template?: string;
          body_template?: string;
          delay_days?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      campaign_sends: {
        Row: {
          id: string;
          campaign_step_id: string;
          outreach_contact_id: string;
          status: Database["public"]["Enums"]["campaign_step_status"] | null;
          sent_at: string | null;
          opened_at: string | null;
          replied_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          campaign_step_id: string;
          outreach_contact_id: string;
          status?: Database["public"]["Enums"]["campaign_step_status"] | null;
          sent_at?: string | null;
          opened_at?: string | null;
          replied_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          campaign_step_id?: string;
          outreach_contact_id?: string;
          status?: Database["public"]["Enums"]["campaign_step_status"] | null;
          sent_at?: string | null;
          opened_at?: string | null;
          replied_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      agent_runs: {
        Row: {
          id: string;
          organization_id: string;
          agent_type: Database["public"]["Enums"]["agent_type"];
          status: Database["public"]["Enums"]["agent_run_status"] | null;
          input_params: Json | null;
          output_summary: string | null;
          items_found: number | null;
          items_processed: number | null;
          error_message: string | null;
          tokens_used: number | null;
          duration_ms: number | null;
          triggered_by: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          agent_type: Database["public"]["Enums"]["agent_type"];
          status?: Database["public"]["Enums"]["agent_run_status"] | null;
          input_params?: Json | null;
          output_summary?: string | null;
          items_found?: number | null;
          items_processed?: number | null;
          error_message?: string | null;
          tokens_used?: number | null;
          duration_ms?: number | null;
          triggered_by?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          agent_type?: Database["public"]["Enums"]["agent_type"];
          status?: Database["public"]["Enums"]["agent_run_status"] | null;
          input_params?: Json | null;
          output_summary?: string | null;
          items_found?: number | null;
          items_processed?: number | null;
          error_message?: string | null;
          tokens_used?: number | null;
          duration_ms?: number | null;
          triggered_by?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      platform_config: {
        Row: {
          id: string;
          organization_id: string;
          key: string;
          value: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          key: string;
          value: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          key?: string;
          value?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // --- Phase 4: Email + Calendar integration (migration 002) -------------
      integrations: {
        Row: {
          id: string;
          organization_id: string;
          provider: string;
          access_token: string | null;
          refresh_token: string | null;
          token_expires_at: string | null;
          connected_email: string | null;
          scopes: string[] | null;
          is_active: boolean | null;
          last_sync_at: string | null;
          settings: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          provider: string;
          access_token?: string | null;
          refresh_token?: string | null;
          token_expires_at?: string | null;
          connected_email?: string | null;
          scopes?: string[] | null;
          is_active?: boolean | null;
          last_sync_at?: string | null;
          settings?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          provider?: string;
          access_token?: string | null;
          refresh_token?: string | null;
          token_expires_at?: string | null;
          connected_email?: string | null;
          scopes?: string[] | null;
          is_active?: boolean | null;
          last_sync_at?: string | null;
          settings?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      synced_email_threads: {
        Row: {
          id: string;
          organization_id: string;
          gmail_thread_id: string;
          subject: string | null;
          snippet: string | null;
          last_message_at: string | null;
          message_count: number | null;
          is_read: boolean | null;
          labels: string[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          gmail_thread_id: string;
          subject?: string | null;
          snippet?: string | null;
          last_message_at?: string | null;
          message_count?: number | null;
          is_read?: boolean | null;
          labels?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          gmail_thread_id?: string;
          subject?: string | null;
          snippet?: string | null;
          last_message_at?: string | null;
          message_count?: number | null;
          is_read?: boolean | null;
          labels?: string[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      synced_email_messages: {
        Row: {
          id: string;
          organization_id: string;
          thread_id: string;
          gmail_message_id: string;
          from_email: string | null;
          from_name: string | null;
          to_emails: string[] | null;
          cc_emails: string[] | null;
          subject: string | null;
          body_text: string | null;
          body_html: string | null;
          sent_at: string | null;
          has_attachments: boolean | null;
          attachment_names: string[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          thread_id: string;
          gmail_message_id: string;
          from_email?: string | null;
          from_name?: string | null;
          to_emails?: string[] | null;
          cc_emails?: string[] | null;
          subject?: string | null;
          body_text?: string | null;
          body_html?: string | null;
          sent_at?: string | null;
          has_attachments?: boolean | null;
          attachment_names?: string[] | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          thread_id?: string;
          gmail_message_id?: string;
          from_email?: string | null;
          from_name?: string | null;
          to_emails?: string[] | null;
          cc_emails?: string[] | null;
          subject?: string | null;
          body_text?: string | null;
          body_html?: string | null;
          sent_at?: string | null;
          has_attachments?: boolean | null;
          attachment_names?: string[] | null;
          created_at?: string;
        };
        Relationships: [];
      };
      email_thread_links: {
        Row: {
          id: string;
          organization_id: string;
          thread_id: string;
          funder_id: string | null;
          contact_id: string | null;
          outreach_contact_id: string | null;
          match_type: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          thread_id: string;
          funder_id?: string | null;
          contact_id?: string | null;
          outreach_contact_id?: string | null;
          match_type: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          thread_id?: string;
          funder_id?: string | null;
          contact_id?: string | null;
          outreach_contact_id?: string | null;
          match_type?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      draft_versions: {
        Row: {
          id: string;
          organization_id: string;
          opportunity_id: string;
          application_id: string | null;
          template_type: Database["public"]["Enums"]["draft_template_type"];
          content: string;
          confidence_score: number | null;
          knowledge_sources: Json | null;
          version_number: number;
          humanization_status: Database["public"]["Enums"]["humanization_status"];
          source: string;
          created_by: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          opportunity_id: string;
          application_id?: string | null;
          template_type: Database["public"]["Enums"]["draft_template_type"];
          content: string;
          confidence_score?: number | null;
          knowledge_sources?: Json | null;
          // Assigned per opportunity by a BEFORE INSERT trigger - omit on insert.
          version_number?: number;
          humanization_status?: Database["public"]["Enums"]["humanization_status"];
          source?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          opportunity_id?: string;
          application_id?: string | null;
          template_type?: Database["public"]["Enums"]["draft_template_type"];
          content?: string;
          confidence_score?: number | null;
          knowledge_sources?: Json | null;
          version_number?: number;
          humanization_status?: Database["public"]["Enums"]["humanization_status"];
          source?: string;
          created_by?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      alerts: {
        Row: {
          id: string;
          organization_id: string;
          type: Database["public"]["Enums"]["alert_type"];
          severity: Database["public"]["Enums"]["alert_severity"];
          message: string;
          link: string | null;
          is_read: boolean;
          read_at: string | null;
          is_dismissed: boolean;
          dismissed_at: string | null;
          snoozed_until: string | null;
          opportunity_id: string | null;
          application_id: string | null;
          deadline_id: string | null;
          dedup_key: string;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          type: Database["public"]["Enums"]["alert_type"];
          severity?: Database["public"]["Enums"]["alert_severity"];
          message: string;
          link?: string | null;
          is_read?: boolean;
          read_at?: string | null;
          is_dismissed?: boolean;
          dismissed_at?: string | null;
          snoozed_until?: string | null;
          opportunity_id?: string | null;
          application_id?: string | null;
          deadline_id?: string | null;
          dedup_key: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          type?: Database["public"]["Enums"]["alert_type"];
          severity?: Database["public"]["Enums"]["alert_severity"];
          message?: string;
          link?: string | null;
          is_read?: boolean;
          read_at?: string | null;
          is_dismissed?: boolean;
          dismissed_at?: string | null;
          snoozed_until?: string | null;
          opportunity_id?: string | null;
          application_id?: string | null;
          deadline_id?: string | null;
          dedup_key?: string;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Cross-provider validation verdicts (migration 014). One row per
      // (opportunity_id, provider); an opportunity is "Verified" when both
      // independent providers return a 'verified' verdict.
      validations: {
        Row: {
          id: string;
          organization_id: string;
          opportunity_id: string;
          provider: string;
          model: string | null;
          verdict: Database["public"]["Enums"]["validation_verdict"];
          confidence: number;
          details: Json;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          opportunity_id: string;
          provider: string;
          model?: string | null;
          verdict: Database["public"]["Enums"]["validation_verdict"];
          confidence?: number;
          details?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          opportunity_id?: string;
          provider?: string;
          model?: string | null;
          verdict?: Database["public"]["Enums"]["validation_verdict"];
          confidence?: number;
          details?: Json;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      historical_awards: {
        Row: {
          id: string;
          organization_id: string;
          recipient_name: string | null;
          award_amount: number | null;
          award_date: string | null;
          awarding_agency: string | null;
          description: string | null;
          award_id: string | null;
          source: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          recipient_name?: string | null;
          award_amount?: number | null;
          award_date?: string | null;
          awarding_agency?: string | null;
          description?: string | null;
          award_id?: string | null;
          source?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          recipient_name?: string | null;
          award_amount?: number | null;
          award_date?: string | null;
          awarding_agency?: string | null;
          description?: string | null;
          award_id?: string | null;
          source?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      funder_intelligence: {
        Row: {
          id: string;
          organization_id: string;
          funder_id: string;
          priorities: string[] | null;
          recent_grants: Json | null;
          board_members: Json | null;
          review_criteria: string | null;
          funding_cycles: string | null;
          average_grant_size: number | null;
          total_annual_giving: number | null;
          application_tips: string | null;
          last_scraped_at: string | null;
          raw_data: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          funder_id: string;
          priorities?: string[] | null;
          recent_grants?: Json | null;
          board_members?: Json | null;
          review_criteria?: string | null;
          funding_cycles?: string | null;
          average_grant_size?: number | null;
          total_annual_giving?: number | null;
          application_tips?: string | null;
          last_scraped_at?: string | null;
          raw_data?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          funder_id?: string;
          priorities?: string[] | null;
          recent_grants?: Json | null;
          board_members?: Json | null;
          review_criteria?: string | null;
          funding_cycles?: string | null;
          average_grant_size?: number | null;
          total_annual_giving?: number | null;
          application_tips?: string | null;
          last_scraped_at?: string | null;
          raw_data?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      renewals: {
        Row: {
          id: string;
          organization_id: string;
          application_id: string;
          opportunity_id: string;
          funder_id: string | null;
          renewal_type: string;
          reporting_deadline: string | null;
          renewal_window_start: string | null;
          renewal_window_end: string | null;
          compliance_status: string;
          compliance_notes: string | null;
          auto_narrative_draft: string | null;
          alert_sent_60d: boolean;
          alert_sent_30d: boolean;
          alert_sent_14d: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          application_id: string;
          opportunity_id: string;
          funder_id?: string | null;
          renewal_type?: string;
          reporting_deadline?: string | null;
          renewal_window_start?: string | null;
          renewal_window_end?: string | null;
          compliance_status?: string;
          compliance_notes?: string | null;
          auto_narrative_draft?: string | null;
          alert_sent_60d?: boolean;
          alert_sent_30d?: boolean;
          alert_sent_14d?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          application_id?: string;
          opportunity_id?: string;
          funder_id?: string | null;
          renewal_type?: string;
          reporting_deadline?: string | null;
          renewal_window_start?: string | null;
          renewal_window_end?: string | null;
          compliance_status?: string;
          compliance_notes?: string | null;
          auto_narrative_draft?: string | null;
          alert_sent_60d?: boolean;
          alert_sent_30d?: boolean;
          alert_sent_14d?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Migration 018 - email_activity: AI-classified inbound email records.
      email_activity: {
        Row: {
          id: string;
          organization_id: string;
          funder_id: string | null;
          opportunity_id: string | null;
          application_id: string | null;
          email_type: string;
          subject: string | null;
          sender: string | null;
          received_at: string | null;
          summary: string | null;
          action_required: boolean;
          action_description: string | null;
          urgency: string;
          thread_id: string | null;
          processed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          funder_id?: string | null;
          opportunity_id?: string | null;
          application_id?: string | null;
          email_type: string;
          subject?: string | null;
          sender?: string | null;
          received_at?: string | null;
          summary?: string | null;
          action_required?: boolean;
          action_description?: string | null;
          urgency?: string;
          thread_id?: string | null;
          processed_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          funder_id?: string | null;
          opportunity_id?: string | null;
          application_id?: string | null;
          email_type?: string;
          subject?: string | null;
          sender?: string | null;
          received_at?: string | null;
          summary?: string | null;
          action_required?: boolean;
          action_description?: string | null;
          urgency?: string;
          thread_id?: string | null;
          processed_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      // --- Phase 3: Browser Automation (migration 002 + 020) -----------------
      automation_sessions: {
        Row: {
          id: string;
          organization_id: string;
          application_id: string | null;
          opportunity_id: string | null;
          funder_id: string | null;
          status: Database["public"]["Enums"]["automation_status"];
          session_type: Database["public"]["Enums"]["session_type"] | null;
          target_url: string | null;
          mapped_fields: Json;
          unmapped_fields: Json;
          steps: Json;
          screenshots: string[];
          confirmation_number: string | null;
          error_message: string | null;
          notes: string | null;
          started_by: string | null;
          approved_by: string | null;
          approval_required_at: string | null;
          started_at: string | null;
          completed_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          application_id?: string | null;
          opportunity_id?: string | null;
          funder_id?: string | null;
          status?: Database["public"]["Enums"]["automation_status"];
          session_type?: Database["public"]["Enums"]["session_type"] | null;
          target_url?: string | null;
          mapped_fields?: Json;
          unmapped_fields?: Json;
          steps?: Json;
          screenshots?: string[];
          confirmation_number?: string | null;
          error_message?: string | null;
          notes?: string | null;
          started_by?: string | null;
          approved_by?: string | null;
          approval_required_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          application_id?: string | null;
          opportunity_id?: string | null;
          funder_id?: string | null;
          status?: Database["public"]["Enums"]["automation_status"];
          session_type?: Database["public"]["Enums"]["session_type"] | null;
          target_url?: string | null;
          mapped_fields?: Json;
          unmapped_fields?: Json;
          steps?: Json;
          screenshots?: string[];
          confirmation_number?: string | null;
          error_message?: string | null;
          notes?: string | null;
          started_by?: string | null;
          approved_by?: string | null;
          approval_required_at?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      automation_steps: {
        Row: {
          id: string;
          session_id: string;
          step_number: number;
          action: string;
          description: string | null;
          status: string;
          input_data: Json | null;
          output_data: Json | null;
          error_message: string | null;
          duration_ms: number | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          step_number: number;
          action: string;
          description?: string | null;
          status?: string;
          input_data?: Json | null;
          output_data?: Json | null;
          error_message?: string | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          step_number?: number;
          action?: string;
          description?: string | null;
          status?: string;
          input_data?: Json | null;
          output_data?: Json | null;
          error_message?: string | null;
          duration_ms?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 024 - append-only audit trail (Behavioral Contracts §24).
      audit_logs: {
        Row: {
          id: string;
          organization_id: string;
          user_id: string | null;
          action: string;
          entity_type: string | null;
          entity_id: string | null;
          details: Json | null;
          ip_address: string | null;
          user_agent: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          user_id?: string | null;
          action: string;
          entity_type?: string | null;
          entity_id?: string | null;
          details?: Json | null;
          ip_address?: string | null;
          user_agent?: string | null;
          created_at?: string;
        };
        Update: Record<string, never>;
        Relationships: [];
      };
      automation_screenshots: {
        Row: {
          id: string;
          session_id: string;
          step_id: string | null;
          storage_path: string;
          description: string | null;
          page_url: string | null;
          captured_at: string;
        };
        Insert: {
          id?: string;
          session_id: string;
          step_id?: string | null;
          storage_path: string;
          description?: string | null;
          page_url?: string | null;
          captured_at?: string;
        };
        Update: {
          id?: string;
          session_id?: string;
          step_id?: string | null;
          storage_path?: string;
          description?: string | null;
          page_url?: string | null;
          captured_at?: string;
        };
        Relationships: [];
      };
      // Migration 033 — encrypted API key storage per SCHEMA_REGISTRY v2.0 §2.47.
      integration_keys: {
        Row: {
          id: string;
          organization_id: string;
          service_name: Database["public"]["Enums"]["integration_service"];
          encrypted_key: string;
          is_active: boolean;
          last_validated_at: string | null;
          validation_status: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          service_name: Database["public"]["Enums"]["integration_service"];
          encrypted_key: string;
          is_active?: boolean;
          last_validated_at?: string | null;
          validation_status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          service_name?: Database["public"]["Enums"]["integration_service"];
          encrypted_key?: string;
          is_active?: boolean;
          last_validated_at?: string | null;
          validation_status?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Migration 041 — scraping targets for AI-powered web scraping (SCHEMA_REGISTRY v2.0 §2.49).
      scraping_targets: {
        Row: {
          id: string;
          organization_id: string;
          url: string;
          description: string | null;
          scrape_schedule: string;
          last_scraped_at: string | null;
          last_success_at: string | null;
          failure_count: number;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          url: string;
          description?: string | null;
          scrape_schedule?: string;
          last_scraped_at?: string | null;
          last_success_at?: string | null;
          failure_count?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          url?: string;
          description?: string | null;
          scrape_schedule?: string;
          last_scraped_at?: string | null;
          last_success_at?: string | null;
          failure_count?: number;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Migration 044 — automation_notifications (SCHEMA_REGISTRY v2.0 §2.58).
      automation_notifications: {
        Row: {
          id: string;
          organization_id: string;
          event_type: string;
          title: string;
          message: string | null;
          is_read: boolean;
          sent_via: string;
          related_entity_type: string | null;
          related_entity_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          event_type: string;
          title: string;
          message?: string | null;
          is_read?: boolean;
          sent_via?: string;
          related_entity_type?: string | null;
          related_entity_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          event_type?: string;
          title?: string;
          message?: string | null;
          is_read?: boolean;
          sent_via?: string;
          related_entity_type?: string | null;
          related_entity_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 045 — custom_api_connections (SCHEMA_REGISTRY v2.0 §2.48).
      custom_api_connections: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          base_url: string;
          auth_type: string;
          auth_config: Json;
          field_mapping: Json;
          poll_schedule: string;
          is_active: boolean;
          last_polled_at: string | null;
          last_success_at: string | null;
          error_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          base_url: string;
          auth_type?: string;
          auth_config?: Json;
          field_mapping?: Json;
          poll_schedule?: string;
          is_active?: boolean;
          last_polled_at?: string | null;
          last_success_at?: string | null;
          error_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          base_url?: string;
          auth_type?: string;
          auth_config?: Json;
          field_mapping?: Json;
          poll_schedule?: string;
          is_active?: boolean;
          last_polled_at?: string | null;
          last_success_at?: string | null;
          error_count?: number;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Migration 046 — automation_queue (SCHEMA_REGISTRY v2.0 §2.44).
      automation_queue: {
        Row: {
          id: string;
          organization_id: string;
          application_id: string;
          priority: number;
          status: string;
          automation_level: string;
          retry_count: number;
          max_retries: number;
          error_log: Json;
          worker_id: string | null;
          created_at: string;
          started_at: string | null;
          completed_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          application_id: string;
          priority?: number;
          status?: string;
          automation_level?: string;
          retry_count?: number;
          max_retries?: number;
          error_log?: Json;
          worker_id?: string | null;
          created_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          application_id?: string;
          priority?: number;
          status?: string;
          automation_level?: string;
          retry_count?: number;
          max_retries?: number;
          error_log?: Json;
          worker_id?: string | null;
          created_at?: string;
          started_at?: string | null;
          completed_at?: string | null;
        };
        Relationships: [];
      };
      // Migration 048 — competitor_tracking (SCHEMA_REGISTRY v2.0 §2.52).
      competitor_tracking: {
        Row: {
          id: string;
          organization_id: string;
          competitor_name: string | null;
          competitor_ein: string | null;
          funder_id: string | null;
          grant_amount: number | null;
          grant_purpose: string | null;
          fiscal_year: number | null;
          source: string | null;
          competition_level: string | null;
          estimated_applicants: number | null;
          observed_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          competitor_name?: string | null;
          competitor_ein?: string | null;
          funder_id?: string | null;
          grant_amount?: number | null;
          grant_purpose?: string | null;
          fiscal_year?: number | null;
          source?: string | null;
          competition_level?: string | null;
          estimated_applicants?: number | null;
          observed_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          competitor_name?: string | null;
          competitor_ein?: string | null;
          funder_id?: string | null;
          grant_amount?: number | null;
          grant_purpose?: string | null;
          fiscal_year?: number | null;
          source?: string | null;
          competition_level?: string | null;
          estimated_applicants?: number | null;
          observed_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 049 — success_probability_scores (SCHEMA_REGISTRY v2.0 §2.51).
      success_probability_scores: {
        Row: {
          id: string;
          organization_id: string;
          application_id: string;
          probability_score: number;
          factors: Json;
          data_quality: string | null;
          calculated_at: string;
          updated_at: string | null;
        };
        Insert: {
          id?: string;
          organization_id: string;
          application_id: string;
          probability_score: number;
          factors?: Json;
          data_quality?: string | null;
          calculated_at?: string;
          updated_at?: string | null;
        };
        Update: {
          id?: string;
          organization_id?: string;
          application_id?: string;
          probability_score?: number;
          factors?: Json;
          data_quality?: string | null;
          calculated_at?: string;
          updated_at?: string | null;
        };
        Relationships: [];
      };
      // Migration 050 — user_invitations (used by settings/invite flow).
      user_invitations: {
        Row: {
          id: string;
          organization_id: string;
          email: string;
          role: string;
          token: string;
          status: string;
          invited_by: string | null;
          accepted_by: string | null;
          expires_at: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          email: string;
          role: string;
          token: string;
          status?: string;
          invited_by?: string | null;
          accepted_by?: string | null;
          expires_at: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          email?: string;
          role?: string;
          token?: string;
          status?: string;
          invited_by?: string | null;
          accepted_by?: string | null;
          expires_at?: string;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Migration 047 — funder_giving_history (SCHEMA_REGISTRY v2.0 §2.46).
      funder_giving_history: {
        Row: {
          id: string;
          organization_id: string;
          funder_id: string;
          recipient_name: string;
          recipient_ein: string | null;
          amount: number | null;
          purpose: string | null;
          fiscal_year: number;
          source_filing_url: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          funder_id: string;
          recipient_name: string;
          recipient_ein?: string | null;
          amount?: number | null;
          purpose?: string | null;
          fiscal_year: number;
          source_filing_url?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          funder_id?: string;
          recipient_name?: string;
          recipient_ein?: string | null;
          amount?: number | null;
          purpose?: string | null;
          fiscal_year?: number;
          source_filing_url?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 045 — form_templates (AutoApply form structure cache).
      form_templates: {
        Row: {
          id: string;
          organization_id: string;
          funder_id: string | null;
          portal_url: string;
          form_structure: Json | null;
          field_mapping: Json | null;
          is_multi_step: boolean;
          step_navigation: Json | null;
          requires_login: boolean;
          requires_file_upload: boolean;
          file_upload_fields: Json | null;
          automation_assessment: Json | null;
          last_verified_at: string | null;
          last_used_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          funder_id?: string | null;
          portal_url: string;
          form_structure?: Json | null;
          field_mapping?: Json | null;
          is_multi_step?: boolean;
          step_navigation?: Json | null;
          requires_login?: boolean;
          requires_file_upload?: boolean;
          file_upload_fields?: Json | null;
          automation_assessment?: Json | null;
          last_verified_at?: string | null;
          last_used_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          funder_id?: string | null;
          portal_url?: string;
          form_structure?: Json | null;
          field_mapping?: Json | null;
          is_multi_step?: boolean;
          step_navigation?: Json | null;
          requires_login?: boolean;
          requires_file_upload?: boolean;
          file_upload_fields?: Json | null;
          automation_assessment?: Json | null;
          last_verified_at?: string | null;
          last_used_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Migration 045 — autoapply_submissions (submission attempt log).
      autoapply_submissions: {
        Row: {
          id: string;
          organization_id: string;
          funder_id: string | null;
          form_template_id: string | null;
          status: string;
          request_description: string | null;
          request_type: string | null;
          request_amount: number | null;
          pre_submit_screenshot_url: string | null;
          confirmation_screenshot_url: string | null;
          confirmation_number: string | null;
          error_message: string | null;
          error_screenshot_url: string | null;
          retry_count: number;
          next_retry_at: string | null;
          submitted_at: string | null;
          request_profile_id: string | null;
          submission_channel: string | null;
          personalized_pitch: string | null;
          optimized_amount: number | null;
          timing_score: number | null;
          confirmation_data: Json | null;
          documents_attached: string[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          funder_id?: string | null;
          form_template_id?: string | null;
          status?: string;
          request_description?: string | null;
          request_type?: string | null;
          request_amount?: number | null;
          pre_submit_screenshot_url?: string | null;
          confirmation_screenshot_url?: string | null;
          confirmation_number?: string | null;
          error_message?: string | null;
          error_screenshot_url?: string | null;
          retry_count?: number;
          next_retry_at?: string | null;
          submitted_at?: string | null;
          request_profile_id?: string | null;
          submission_channel?: string | null;
          personalized_pitch?: string | null;
          optimized_amount?: number | null;
          timing_score?: number | null;
          confirmation_data?: Json | null;
          documents_attached?: string[] | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          funder_id?: string | null;
          form_template_id?: string | null;
          status?: string;
          request_description?: string | null;
          request_type?: string | null;
          request_amount?: number | null;
          pre_submit_screenshot_url?: string | null;
          confirmation_screenshot_url?: string | null;
          confirmation_number?: string | null;
          error_message?: string | null;
          error_screenshot_url?: string | null;
          retry_count?: number;
          next_retry_at?: string | null;
          submitted_at?: string | null;
          request_profile_id?: string | null;
          submission_channel?: string | null;
          personalized_pitch?: string | null;
          optimized_amount?: number | null;
          timing_score?: number | null;
          confirmation_data?: Json | null;
          documents_attached?: string[] | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 045 — submission_queue (AutoApply worker queue).
      submission_queue: {
        Row: {
          id: string;
          organization_id: string;
          funder_id: string | null;
          priority: number;
          status: string;
          automation_mode: string;
          scheduled_for: string | null;
          started_at: string | null;
          completed_at: string | null;
          submission_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          funder_id?: string | null;
          priority?: number;
          status?: string;
          automation_mode?: string;
          scheduled_for?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          submission_id?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          funder_id?: string | null;
          priority?: number;
          status?: string;
          automation_mode?: string;
          scheduled_for?: string | null;
          started_at?: string | null;
          completed_at?: string | null;
          submission_id?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 052: queue_controls — Queue Control Plane pause states (no RLS, admin-managed).
      queue_controls: {
        Row: {
          id: string;
          control_type: string;
          target_id: string | null;
          paused: boolean;
          paused_by: string | null;
          paused_at: string | null;
          reason: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          control_type: string;
          target_id?: string | null;
          paused?: boolean;
          paused_by?: string | null;
          paused_at?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          control_type?: string;
          target_id?: string | null;
          paused?: boolean;
          paused_by?: string | null;
          paused_at?: string | null;
          reason?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 047: worker_status — Railway AutoApply worker heartbeat (no RLS, admin-managed)
      worker_status: {
        Row: {
          id: string;
          worker_id: string;
          status: string;
          last_heartbeat_at: string;
          started_at: string;
          current_item_id: string | null;
          items_processed: number;
          items_failed: number;
          version: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          worker_id: string;
          status?: string;
          last_heartbeat_at?: string;
          started_at?: string;
          current_item_id?: string | null;
          items_processed?: number;
          items_failed?: number;
          version?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          worker_id?: string;
          status?: string;
          last_heartbeat_at?: string;
          started_at?: string;
          current_item_id?: string | null;
          items_processed?: number;
          items_failed?: number;
          version?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 050 — funder_credentials (encrypted portal login credentials).
      funder_credentials: {
        Row: {
          id: string;
          organization_id: string;
          funder_id: string;
          portal_url: string;
          username: string;
          encrypted_password: string;
          mfa_secret: string | null;
          login_method: string;
          last_login_at: string | null;
          login_success: boolean | null;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          funder_id: string;
          portal_url: string;
          username: string;
          encrypted_password: string;
          mfa_secret?: string | null;
          login_method?: string;
          last_login_at?: string | null;
          login_success?: boolean | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          funder_id?: string;
          portal_url?: string;
          username?: string;
          encrypted_password?: string;
          mfa_secret?: string | null;
          login_method?: string;
          last_login_at?: string | null;
          login_success?: boolean | null;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Migration 050 — autoapply_screenshots (screenshot audit trail per submission).
      autoapply_screenshots: {
        Row: {
          id: string;
          submission_id: string | null;
          stage: string;
          storage_path: string;
          captured_at: string;
          metadata: Record<string, unknown>;
        };
        Insert: {
          id?: string;
          submission_id?: string | null;
          stage: string;
          storage_path: string;
          captured_at?: string;
          metadata?: Record<string, unknown>;
        };
        Update: {
          id?: string;
          submission_id?: string | null;
          stage?: string;
          storage_path?: string;
          captured_at?: string;
          metadata?: Record<string, unknown>;
        };
        Relationships: [];
      };
      // Migration 050 — autoapply_review_queue (human review queue for failed/blocked submissions).
      autoapply_review_queue: {
        Row: {
          id: string;
          submission_id: string | null;
          organization_id: string;
          funder_id: string;
          reason: string;
          failure_count: number;
          status: string;
          assigned_to: string | null;
          resolved_at: string | null;
          resolution_notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          submission_id?: string | null;
          organization_id: string;
          funder_id: string;
          reason: string;
          failure_count?: number;
          status?: string;
          assigned_to?: string | null;
          resolved_at?: string | null;
          resolution_notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          submission_id?: string | null;
          organization_id?: string;
          funder_id?: string;
          reason?: string;
          failure_count?: number;
          status?: string;
          assigned_to?: string | null;
          resolved_at?: string | null;
          resolution_notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 050 — solicitation_registrations (charitable solicitation state registrations).
      solicitation_registrations: {
        Row: {
          id: string;
          organization_id: string;
          state: string;
          registration_number: string | null;
          registered_at: string | null;
          expires_at: string | null;
          status: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          state: string;
          registration_number?: string | null;
          registered_at?: string | null;
          expires_at?: string | null;
          status?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          state?: string;
          registration_number?: string | null;
          registered_at?: string | null;
          expires_at?: string | null;
          status?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 052 — webhook_configs (AutoApply webhook notification endpoints per org).
      webhook_configs: {
        Row: {
          id: string;
          organization_id: string;
          type: string;
          webhook_url: string;
          events: string[];
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          type?: string;
          webhook_url: string;
          events?: string[];
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          type?: string;
          webhook_url?: string;
          events?: string[];
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Migration 051 — request_profiles (Request Profile System, AUTOAPPLY_ARCHITECTURE_V2 §2C).
      request_profiles: {
        Row: {
          id: string;
          organization_id: string;
          name: string;
          request_type: string;
          priority: number;
          active: boolean;
          needs_description: string;
          specific_requirements: Json;
          target_funder_categories: string[] | null;
          target_funder_types: string[] | null;
          pitch_template: string | null;
          form_field_overrides: Json;
          success_criteria: string | null;
          min_value: number | null;
          max_value: number | null;
          value_unit: string;
          geographic_requirements: Json | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          name: string;
          request_type: string;
          priority?: number;
          active?: boolean;
          needs_description: string;
          specific_requirements?: Json;
          target_funder_categories?: string[] | null;
          target_funder_types?: string[] | null;
          pitch_template?: string | null;
          form_field_overrides?: Json;
          success_criteria?: string | null;
          min_value?: number | null;
          max_value?: number | null;
          value_unit?: string;
          geographic_requirements?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          name?: string;
          request_type?: string;
          priority?: number;
          active?: boolean;
          needs_description?: string;
          specific_requirements?: Json;
          target_funder_categories?: string[] | null;
          target_funder_types?: string[] | null;
          pitch_template?: string | null;
          form_field_overrides?: Json;
          success_criteria?: string | null;
          min_value?: number | null;
          max_value?: number | null;
          value_unit?: string;
          geographic_requirements?: Json | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Migration 052 — cross_client_submissions (anonymized cross-tenant dedup log, no RLS).
      cross_client_submissions: {
        Row: {
          id: string;
          funder_domain: string;
          org_hash: string;
          submitted_at: string;
        };
        Insert: {
          id?: string;
          funder_domain: string;
          org_hash: string;
          submitted_at?: string;
        };
        Update: {
          id?: string;
          funder_domain?: string;
          org_hash?: string;
          submitted_at?: string;
        };
        Relationships: [];
      };
      // Grant Intelligence Library — global shared tables, no RLS, no organization_id.
      intelligence_funded_proposals: {
        Row: {
          id: string;
          source: string;
          source_url: string | null;
          funder_name: string | null;
          funder_type: string | null;
          grant_program: string | null;
          award_amount: number | null;
          award_year: number | null;
          category: string[] | null;
          full_text: string | null;
          reviewer_comments: string | null;
          metadata: Json | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          source: string;
          source_url?: string | null;
          funder_name?: string | null;
          funder_type?: string | null;
          grant_program?: string | null;
          award_amount?: number | null;
          award_year?: number | null;
          category?: string[] | null;
          full_text?: string | null;
          reviewer_comments?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          source?: string;
          source_url?: string | null;
          funder_name?: string | null;
          funder_type?: string | null;
          grant_program?: string | null;
          award_amount?: number | null;
          award_year?: number | null;
          category?: string[] | null;
          full_text?: string | null;
          reviewer_comments?: string | null;
          metadata?: Json | null;
          created_at?: string;
        };
        Relationships: [];
      };
      intelligence_proposal_sections: {
        Row: {
          id: string;
          proposal_id: string;
          section_type: string;
          section_text: string;
          quality_score: number | null;
          embedding: number[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          proposal_id: string;
          section_type: string;
          section_text: string;
          quality_score?: number | null;
          embedding?: number[] | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          proposal_id?: string;
          section_type?: string;
          section_text?: string;
          quality_score?: number | null;
          embedding?: number[] | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Grant Intelligence Library — Night 2-3 tables (scoring rubrics, logic models, need data).
      intelligence_scoring_rubrics: {
        Row: {
          id: string;
          source: string;
          source_url: string | null;
          funder_name: string | null;
          grant_program: string | null;
          category: string[] | null;
          dimensions: Json;
          full_text: string | null;
          embedding: number[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          source: string;
          source_url?: string | null;
          funder_name?: string | null;
          grant_program?: string | null;
          category?: string[] | null;
          dimensions?: Json;
          full_text?: string | null;
          embedding?: number[] | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          source?: string;
          source_url?: string | null;
          funder_name?: string | null;
          grant_program?: string | null;
          category?: string[] | null;
          dimensions?: Json;
          full_text?: string | null;
          embedding?: number[] | null;
          created_at?: string;
        };
        Relationships: [];
      };
      intelligence_logic_models: {
        Row: {
          id: string;
          category: string;
          subcategory: string | null;
          inputs: Json;
          activities: Json;
          outputs: Json;
          outcomes: Json;
          impact: Json;
          source: string | null;
          is_template: boolean | null;
          embedding: number[] | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          category: string;
          subcategory?: string | null;
          inputs?: Json;
          activities?: Json;
          outputs?: Json;
          outcomes?: Json;
          impact?: Json;
          source?: string | null;
          is_template?: boolean | null;
          embedding?: number[] | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          category?: string;
          subcategory?: string | null;
          inputs?: Json;
          activities?: Json;
          outputs?: Json;
          outcomes?: Json;
          impact?: Json;
          source?: string | null;
          is_template?: boolean | null;
          embedding?: number[] | null;
          created_at?: string;
        };
        Relationships: [];
      };
      intelligence_need_data: {
        Row: {
          id: string;
          source: string;
          source_url: string | null;
          data_type: string;
          geographic_level: string;
          state: string | null;
          county: string | null;
          city: string | null;
          zip: string | null;
          metric_name: string;
          metric_value: string;
          metric_year: number | null;
          context: string | null;
          citation: string;
          raw_data: Json | null;
          embedding: number[] | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          source: string;
          source_url?: string | null;
          data_type: string;
          geographic_level: string;
          state?: string | null;
          county?: string | null;
          city?: string | null;
          zip?: string | null;
          metric_name: string;
          metric_value: string;
          metric_year?: number | null;
          context?: string | null;
          citation: string;
          raw_data?: Json | null;
          embedding?: number[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          source?: string;
          source_url?: string | null;
          data_type?: string;
          geographic_level?: string;
          state?: string | null;
          county?: string | null;
          city?: string | null;
          zip?: string | null;
          metric_name?: string;
          metric_value?: string;
          metric_year?: number | null;
          context?: string | null;
          citation?: string;
          raw_data?: Json | null;
          embedding?: number[] | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      // Migration 049: auto_queue_config - autonomous queue population settings per org.
      auto_queue_config: {
        Row: {
          id: string;
          organization_id: string;
          enabled: boolean;
          max_per_batch: number;
          schedule: string;
          categories: string[] | null;
          geographic_scope: string[] | null;
          min_company_size: string | null;
          exclusion_list: string[] | null;
          dedup_window_days: number;
          last_run_at: string | null;
          last_run_queued: number | null;
          last_run_skipped: number | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          enabled?: boolean;
          max_per_batch?: number;
          schedule?: string;
          categories?: string[] | null;
          geographic_scope?: string[] | null;
          min_company_size?: string | null;
          exclusion_list?: string[] | null;
          dedup_window_days?: number;
          last_run_at?: string | null;
          last_run_queued?: number | null;
          last_run_skipped?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          enabled?: boolean;
          max_per_batch?: number;
          schedule?: string;
          categories?: string[] | null;
          geographic_scope?: string[] | null;
          min_company_size?: string | null;
          exclusion_list?: string[] | null;
          dedup_window_days?: number;
          last_run_at?: string | null;
          last_run_queued?: number | null;
          last_run_skipped?: number | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "auto_queue_config_organization_id_fkey";
            columns: ["organization_id"];
            isOneToOne: true;
            referencedRelation: "organizations";
            referencedColumns: ["id"];
          },
        ];
      };
      // Migration 046: foundation_directory - IRS BMF public reference data (no RLS)
      foundation_directory: {
        Row: {
          id: string;
          ein: string;
          name: string;
          dba: string | null;
          city: string | null;
          state: string | null;
          zip: string | null;
          ntee_code: string | null;
          subsection_code: string | null;
          foundation_type: string | null;
          revenue_amount: number | null;
          asset_amount: number | null;
          ruling_date: string | null;
          tax_period: string | null;
          activity_codes: string | null;
          organization_type: string | null;
          status: string | null;
          website: string | null;
          email: string | null;
          phone: string | null;
          giving_total: number | null;
          geographic_focus: string | null;
          imported_at: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          ein: string;
          name: string;
          dba?: string | null;
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          ntee_code?: string | null;
          subsection_code?: string | null;
          foundation_type?: string | null;
          revenue_amount?: number | null;
          asset_amount?: number | null;
          ruling_date?: string | null;
          tax_period?: string | null;
          activity_codes?: string | null;
          organization_type?: string | null;
          status?: string | null;
          website?: string | null;
          email?: string | null;
          phone?: string | null;
          giving_total?: number | null;
          geographic_focus?: string | null;
          imported_at?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          ein?: string;
          name?: string;
          dba?: string | null;
          city?: string | null;
          state?: string | null;
          zip?: string | null;
          ntee_code?: string | null;
          subsection_code?: string | null;
          foundation_type?: string | null;
          revenue_amount?: number | null;
          asset_amount?: number | null;
          ruling_date?: string | null;
          tax_period?: string | null;
          activity_codes?: string | null;
          organization_type?: string | null;
          status?: string | null;
          website?: string | null;
          email?: string | null;
          phone?: string | null;
          giving_total?: number | null;
          geographic_focus?: string | null;
          imported_at?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      // Org-scoped document vault — one current record per document_type per org.
      // Created by migration 048 (AutoApply Phase 3C).
      org_documents: {
        Row: {
          id: string;
          organization_id: string;
          document_type: string;
          file_name: string;
          storage_path: string;
          mime_type: string | null;
          file_size: number | null;
          uploaded_by: string | null;
          expires_at: string | null;
          is_current: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          document_type: string;
          file_name: string;
          storage_path: string;
          mime_type?: string | null;
          file_size?: number | null;
          uploaded_by?: string | null;
          expires_at?: string | null;
          is_current?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          document_type?: string;
          file_name?: string;
          storage_path?: string;
          mime_type?: string | null;
          file_size?: number | null;
          uploaded_by?: string | null;
          expires_at?: string | null;
          is_current?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 051 — submission_receipts (PDF receipts for AutoApply submissions).
      submission_receipts: {
        Row: {
          id: string;
          submission_id: string | null;
          organization_id: string;
          receipt_pdf_path: string | null;
          receipt_data: Json;
          generated_at: string;
        };
        Insert: {
          id?: string;
          submission_id?: string | null;
          organization_id: string;
          receipt_pdf_path?: string | null;
          receipt_data: Json;
          generated_at?: string;
        };
        Update: {
          id?: string;
          submission_id?: string | null;
          organization_id?: string;
          receipt_pdf_path?: string | null;
          receipt_data?: Json;
          generated_at?: string;
        };
        Relationships: [];
      };
      // Migration 051 — grant_agreements (post-award agreement tracking).
      grant_agreements: {
        Row: {
          id: string;
          submission_id: string | null;
          organization_id: string;
          funder_id: string;
          amount_awarded: number | null;
          award_type: string | null;
          agreement_date: string | null;
          start_date: string | null;
          end_date: string | null;
          terms: string | null;
          reporting_requirements: Json | null;
          payment_schedule: Json | null;
          status: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          submission_id?: string | null;
          organization_id: string;
          funder_id: string;
          amount_awarded?: number | null;
          award_type?: string | null;
          agreement_date?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          terms?: string | null;
          reporting_requirements?: Json | null;
          payment_schedule?: Json | null;
          status?: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          submission_id?: string | null;
          organization_id?: string;
          funder_id?: string;
          amount_awarded?: number | null;
          award_type?: string | null;
          agreement_date?: string | null;
          start_date?: string | null;
          end_date?: string | null;
          terms?: string | null;
          reporting_requirements?: Json | null;
          payment_schedule?: Json | null;
          status?: string;
          notes?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      // Migration 8G — Usage Metering (AUTOAPPLY_ARCHITECTURE_V2.md §8G)
      submission_usage: {
        Row: {
          id: string;
          organization_id: string;
          period_start: string;
          period_end: string;
          automated_count: number;
          email_count: number;
          manual_count: number;
          overage_automated: number;
          overage_email: number;
          overage_cost: number;
          api_cost_claude: number;
          api_cost_openai: number;
          proxy_cost: number;
          captcha_cost: number;
          using_own_keys: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          organization_id: string;
          period_start: string;
          period_end: string;
          automated_count?: number;
          email_count?: number;
          manual_count?: number;
          overage_automated?: number;
          overage_email?: number;
          overage_cost?: number;
          api_cost_claude?: number;
          api_cost_openai?: number;
          proxy_cost?: number;
          captcha_cost?: number;
          using_own_keys?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          organization_id?: string;
          period_start?: string;
          period_end?: string;
          automated_count?: number;
          email_count?: number;
          manual_count?: number;
          overage_automated?: number;
          overage_email?: number;
          overage_cost?: number;
          api_cost_claude?: number;
          api_cost_openai?: number;
          proxy_cost?: number;
          captcha_cost?: number;
          using_own_keys?: boolean;
          created_at?: string;
        };
        Relationships: [];
      };
      tier_limits: {
        Row: {
          id: string;
          tier_name: string;
          monthly_automated: number;
          monthly_email: number;
          monthly_manual: number;
          daily_max: number;
          overage_rate_automated: number;
          overage_rate_email: number;
          allow_own_keys: boolean;
        };
        Insert: {
          id?: string;
          tier_name: string;
          monthly_automated: number;
          monthly_email: number;
          monthly_manual: number;
          daily_max: number;
          overage_rate_automated: number;
          overage_rate_email: number;
          allow_own_keys?: boolean;
        };
        Update: {
          id?: string;
          tier_name?: string;
          monthly_automated?: number;
          monthly_email?: number;
          monthly_manual?: number;
          daily_max?: number;
          overage_rate_automated?: number;
          overage_rate_email?: number;
          allow_own_keys?: boolean;
        };
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      // Bootstraps an organization + owner profile for the authenticated user.
      // SECURITY DEFINER; reads name/full_name from auth metadata. Idempotent.
      register_organization: {
        Args: Record<string, never>;
        Returns: string;
      };
      // Returns the calling user's organization_id (used by RLS policies).
      current_org_id: {
        Args: Record<string, never>;
        Returns: string;
      };
    };
    Enums: {
      user_role: "owner" | "admin" | "writer" | "viewer";
      funder_category:
        | "corporate_donation"
        | "corporate_sponsorship"
        | "corporate_foundation"
        | "private_foundation"
        | "government_grant"
        | "local_community_grant"
        | "housing_grant"
        | "education_grant"
        | "faith_compatible_grant"
        | "in_kind_donation"
        | "materials_donation"
        | "down_payment_assistance";
      pipeline_stage:
        | "discovered"
        | "eligibility_review"
        | "qualified"
        | "drafting"
        | "awaiting_documents"
        | "ready_for_review"
        | "submitted"
        | "follow_up_due"
        | "awarded"
        | "denied"
        | "reporting_required"
        | "renewal_opportunity";
      outcome_result: "awarded" | "denied" | "partial";
      document_category:
        | "tax_documents"
        | "legal_documents"
        | "financial_documents"
        | "program_documents"
        | "marketing_materials"
        | "letters_of_support"
        | "application_attachments"
        | "photos";
      deadline_type:
        | "application_deadline"
        | "follow_up_date"
        | "reporting_deadline"
        | "renewal_date"
        | "document_expiration";
      draft_template_type:
        | "grant_narrative"
        | "donation_request_letter"
        | "budget_narrative"
        | "impact_statement"
        | "letter_of_inquiry"
        | "full_proposal";
      humanization_status:
        | "not_humanized"
        | "pending"
        | "humanized"
        | "failed";
      contact_relationship: "cold" | "warm" | "active" | "champion";
      opportunity_status: "open" | "applied" | "closed" | "expired";
      opportunity_source_type:
        | "government_federal"
        | "government_state"
        | "government_local"
        | "private_foundation"
        | "corporate_giving"
        | "community_foundation"
        | "faith_based"
        | "international";
      knowledge_base_category:
        | "mission"
        | "vision"
        | "need_statement"
        | "program_description"
        | "impact"
        | "capacity"
        | "sustainability"
        | "partnerships"
        | "budget_justification"
        | "organizational_history"
        | "custom";
      agent_type:
        | "corporate_research"
        | "foundation_research"
        | "government_research"
        | "local_sponsorship"
        | "eligibility_scoring"
        | "deadline_extraction"
        | "grant_summary"
        | "fit_analysis"
        | "narrative_drafting"
        | "budget_builder"
        | "compliance_check"
        | "review"
        | "final_assembly"
        | "recursive_learning"
        | "cold_outreach"
        | "browser_automation"
        | "email_matching"
        | "email_campaign"
        | "consensus_validation"
        | "funder_intel"
        // Migration 018 - Email Parser Agent.
        | "email_parser"
        // Migration 033 - Tier 6 research/intelligence agents.
        | "grants_gov_research"
        | "sam_gov_research"
        | "propublica_mining"
        | "state_portal"
        | "custom_api_research"
        | "custom_scrape_research"
        | "giving_history_extractor"
        | "success_probability"
        | "funder_relationship"
        | "competitor_intelligence"
        | "deadline_prediction"
        | "application_cloning"
        | "semantic_matching"
        | "follow_up_generator"
        | "automation_worker"
        | "csv_import"
        | "notification_dispatcher"
        | "financial_reconciliation"
        // Aliases / additional values required by Tier 6 task definitions.
        | "giving_history"
        | "competitor_intel"
        | "compliance_calendar"
        // AutoApply Form Analysis Engine.
        | "form_analyzer"
        // AutoApply Form Fill Engine.
        | "form_filler";
      agent_run_status: "pending" | "running" | "completed" | "failed";
      campaign_status: "draft" | "active" | "paused" | "completed";
      campaign_step_status:
        | "pending"
        | "sent"
        | "opened"
        | "replied"
        | "bounced";
      // Phase 2-5 enums (SCHEMA_REGISTRY Phase 2-5 additions / migration 002).
      automation_status:
        | "pending"
        | "in_progress"
        | "awaiting_approval"
        | "approved"
        | "submitted"
        | "failed"
        | "cancelled";
      subscription_tier: "free" | "starter" | "professional" | "enterprise" | "consultant";
      audit_action:
        | "create"
        | "update"
        | "delete"
        | "login"
        | "logout"
        | "export"
        | "invite"
        | "role_change"
        | "billing_change"
        | "agent_run"
        | "submission";
      invitation_status: "pending" | "accepted" | "expired" | "cancelled";
      // Alerts / daily action list (migration 013).
      alert_type:
        | "deadline_due"
        | "new_opportunity"
        | "application_action"
        | "draft_review"
        | "system";
      alert_severity: "info" | "warning" | "critical";
      // Cross-provider validation verdict (migration 014).
      validation_verdict: "verified" | "discrepancy" | "unverifiable";
      // Migration 020 - automation session classification.
      session_type: "form_fill" | "document_upload" | "portal_login";
      // Migration 033 - integration service identifier for integration_keys table.
      integration_service:
        | "sam_gov"
        | "two_captcha"
        | "candid"
        | "gmail"
        | "gcal"
        | "resend"
        | "custom_api";
    };
    CompositeTypes: Record<string, never>;
  };
}

// ---------------------------------------------------------------------------
// Convenience helpers (mirror Supabase's generated helper exports).
// ---------------------------------------------------------------------------

type PublicSchema = Database["public"];

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"];

export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"];

export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"];

export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T];
