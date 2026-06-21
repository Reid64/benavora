import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'autoapply-screenshots';

export type ScreenshotStage =
  | 'page_load'
  | 'pre_fill'
  | 'post_fill'
  | 'pre_submit'
  | 'post_submit'
  | 'confirmation'
  | 'error';

export interface CaptureAndUploadParams {
  orgId: string;
  funderId: string;
  submissionId: string | null;
  supabase: SupabaseClient;
}

/**
 * Manages screenshot capture, storage upload, and audit-trail DB records
 * throughout the AutoApply submission lifecycle.
 *
 * Instances are per-submission: create one at the top of processItem, call
 * captureAndUpload at each stage (submissionId may be null while the record
 * is not yet created), then call linkToSubmission once the submission row exists.
 */
export class ScreenshotManager {
  private readonly capturedIds: string[] = [];

  /**
   * Take a full-page screenshot and return the raw buffer.
   * stage and metadata are accepted for call-site clarity but not used here.
   */
  async capture(page: any, _stage?: string, _metadata?: object): Promise<Buffer> {
    return page.screenshot({ fullPage: true }) as Promise<Buffer>;
  }

  /**
   * Upload a pre-captured buffer to Supabase Storage.
   * Path format: {orgId}/{funderId}/{submissionId}/{stage}_{timestamp}.png
   * Returns the storage path on success.
   */
  async upload(params: {
    buffer: Buffer;
    orgId: string;
    funderId: string;
    submissionId: string;
    stage: string;
    supabase: SupabaseClient;
  }): Promise<string> {
    const { buffer, orgId, funderId, submissionId, stage, supabase } = params;
    const path = `${orgId}/${funderId}/${submissionId}/${stage}_${Date.now()}.png`;

    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'image/png', upsert: true });

    if (error) throw new Error(`[ScreenshotManager] Upload failed for ${stage}: ${error.message}`);
    return path;
  }

  /**
   * Capture a screenshot, upload it, and insert a row into autoapply_screenshots.
   * submissionId may be null before the submission record is created — pass null
   * and call linkToSubmission() afterward to back-fill the FK.
   * Returns the storage path, or '' on non-fatal failure.
   */
  async captureAndUpload(
    page: any,
    stage: string,
    params: CaptureAndUploadParams,
  ): Promise<string> {
    const { orgId, funderId, submissionId, supabase } = params;

    let buffer: Buffer;
    try {
      buffer = (await page.screenshot({ fullPage: true })) as Buffer;
    } catch {
      return '';
    }

    const folder = submissionId ?? 'pending';
    const path = `${orgId}/${funderId}/${folder}/${stage}_${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      console.warn(`[ScreenshotManager] Storage upload failed (${stage}): ${uploadError.message}`);
      return '';
    }

    const { data: inserted, error: insertError } = await supabase
      .from('autoapply_screenshots')
      .insert({ submission_id: submissionId, stage, storage_path: path })
      .select('id')
      .single();

    if (insertError) {
      console.warn(`[ScreenshotManager] DB insert failed (${stage}): ${insertError.message}`);
    } else if (inserted !== null) {
      this.capturedIds.push((inserted as { id: string }).id);
    }

    return path;
  }

  /**
   * Upload a pre-captured buffer (e.g. from FormFillerAgent.confirmationScreenshot)
   * and insert a row into autoapply_screenshots.
   * Returns the storage path, or '' on non-fatal failure.
   */
  async uploadAndRecord(
    buffer: Buffer,
    stage: string,
    params: CaptureAndUploadParams,
  ): Promise<string> {
    const { orgId, funderId, submissionId, supabase } = params;

    const folder = submissionId ?? 'pending';
    const path = `${orgId}/${funderId}/${folder}/${stage}_${Date.now()}.png`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(path, buffer, { contentType: 'image/png', upsert: true });

    if (uploadError) {
      console.warn(`[ScreenshotManager] Storage upload failed (${stage}): ${uploadError.message}`);
      return '';
    }

    const { data: inserted, error: insertError } = await supabase
      .from('autoapply_screenshots')
      .insert({ submission_id: submissionId, stage, storage_path: path })
      .select('id')
      .single();

    if (insertError) {
      console.warn(`[ScreenshotManager] DB insert failed (${stage}): ${insertError.message}`);
    } else if (inserted !== null) {
      this.capturedIds.push((inserted as { id: string }).id);
    }

    return path;
  }

  /**
   * Back-fill submission_id on all autoapply_screenshots rows captured by this
   * instance. Call once after the autoapply_submissions record is created.
   */
  async linkToSubmission(submissionId: string, supabase: SupabaseClient): Promise<void> {
    if (this.capturedIds.length === 0) return;
    const { error } = await supabase
      .from('autoapply_screenshots')
      .update({ submission_id: submissionId })
      .in('id', this.capturedIds);
    if (error) {
      console.warn('[ScreenshotManager] linkToSubmission failed:', error.message);
    }
  }
}
