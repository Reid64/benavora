// Stub — full implementation built in Phase 3A (Form Analysis Engine).
// Analyzes a funder's giving portal, extracts form structure via Claude,
// and persists a reusable form_template record.

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Page } from 'playwright';

export interface AnalyzeOptions {
  page: Page;
  portalUrl: string;
  funderId: string;
  organizationId: string;
}

export class FormAnalyzerAgent {
  constructor(private readonly supabase: SupabaseClient) {
    void this.supabase; // referenced by real implementation
  }

  async analyzeAndStore(_options: AnalyzeOptions): Promise<{ id: string }> {
    throw new Error('FormAnalyzerAgent not yet implemented — Phase 3A pending');
  }
}
