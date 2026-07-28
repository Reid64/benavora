import type { SupabaseClient } from '@supabase/supabase-js';

let intervalId: ReturnType<typeof setInterval> | null = null;
let _client: SupabaseClient | null = null;
let _workerId: string | null = null;
let _isProcessing = false;

export async function register(
  supabase: SupabaseClient,
  workerId: string,
): Promise<void> {
  const { error } = await supabase.from('worker_status').upsert(
    {
      worker_id: workerId,
      status: 'online',
      last_heartbeat_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      items_processed: 0,
      items_failed: 0,
    },
    { onConflict: 'worker_id' },
  );
  if (error) {
    console.error(`[Heartbeat] register() failed for worker_id=${workerId}: ${error.message}`);
  }
}

/**
 * One heartbeat tick. Previously this was a bare `void client.update(...)`
 * inside the interval — never awaited, never checked for an error, and never
 * logged anything. That silence is exactly why a frozen worker_status went
 * undetected: whatever actually failed in production (a transient error, or
 * an UPDATE matching zero rows for any reason) left no trace, so the row
 * just stopped advancing with no signal anywhere. This version awaits the
 * result, logs any error, and — critically — treats a zero-row match the
 * same as an error (an UPDATE with no matching WHERE row succeeds with an
 * empty result, not an error, so it would otherwise still vanish silently)
 * by falling back to the same upsert register() uses. That fallback means a
 * tick can no longer be a permanent no-op: whatever the original failure
 * mode was, the very next tick re-establishes a fresh row instead of
 * compounding the freeze. See DEMO_READINESS_AUDIT.md for the investigation.
 */
async function writeHeartbeat(
  client: SupabaseClient,
  workerId: string,
  status: 'processing' | 'idle',
): Promise<void> {
  const { data, error } = await client
    .from('worker_status')
    .update({ last_heartbeat_at: new Date().toISOString(), status })
    .eq('worker_id', workerId)
    .select('id');

  if (error) {
    console.error(`[Heartbeat] tick update failed for worker_id=${workerId}: ${error.message} — re-registering`);
    await register(client, workerId);
    return;
  }
  if (!data || data.length === 0) {
    console.warn(`[Heartbeat] tick update matched zero rows for worker_id=${workerId} — re-registering`);
    await register(client, workerId);
  }
}

export function start(supabase: SupabaseClient, workerId: string): void {
  if (intervalId !== null) return;
  _client = supabase;
  _workerId = workerId;
  intervalId = setInterval(() => {
    if (_client === null || _workerId === null) return;
    void writeHeartbeat(_client, _workerId, _isProcessing ? 'processing' : 'idle');
  }, 30_000);
}

export function stop(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}

export async function setProcessing(itemId: string | null): Promise<void> {
  if (_client === null || _workerId === null) return;
  _isProcessing = itemId !== null;
  const { error } = await _client
    .from('worker_status')
    .update({
      current_item_id: itemId,
      status: _isProcessing ? 'processing' : 'idle',
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq('worker_id', _workerId);
  if (error) {
    console.error(`[Heartbeat] setProcessing() update failed for worker_id=${_workerId}: ${error.message}`);
  }
}

export async function incrementProcessed(): Promise<void> {
  if (_client === null || _workerId === null) return;
  const { data, error: selectError } = await _client
    .from('worker_status')
    .select('items_processed')
    .eq('worker_id', _workerId)
    .single();
  if (selectError || data === null) {
    console.error(
      `[Heartbeat] incrementProcessed() could not read current count for worker_id=${_workerId}: ${selectError?.message ?? 'no row'}`,
    );
    return;
  }
  const { error: updateError } = await _client
    .from('worker_status')
    .update({ items_processed: (data.items_processed as number) + 1 })
    .eq('worker_id', _workerId);
  if (updateError) {
    console.error(`[Heartbeat] incrementProcessed() update failed for worker_id=${_workerId}: ${updateError.message}`);
  }
}

export async function incrementFailed(): Promise<void> {
  if (_client === null || _workerId === null) return;
  const { data, error: selectError } = await _client
    .from('worker_status')
    .select('items_failed')
    .eq('worker_id', _workerId)
    .single();
  if (selectError || data === null) {
    console.error(
      `[Heartbeat] incrementFailed() could not read current count for worker_id=${_workerId}: ${selectError?.message ?? 'no row'}`,
    );
    return;
  }
  const { error: updateError } = await _client
    .from('worker_status')
    .update({ items_failed: (data.items_failed as number) + 1 })
    .eq('worker_id', _workerId);
  if (updateError) {
    console.error(`[Heartbeat] incrementFailed() update failed for worker_id=${_workerId}: ${updateError.message}`);
  }
}
