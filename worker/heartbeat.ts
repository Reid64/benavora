import type { SupabaseClient } from '@supabase/supabase-js';

let intervalId: ReturnType<typeof setInterval> | null = null;
let _client: SupabaseClient | null = null;
let _workerId: string | null = null;
let _isProcessing = false;

export async function register(
  supabase: SupabaseClient,
  workerId: string,
): Promise<void> {
  await supabase.from('worker_status').upsert(
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
}

export function start(supabase: SupabaseClient, workerId: string): void {
  if (intervalId !== null) return;
  _client = supabase;
  _workerId = workerId;
  intervalId = setInterval(() => {
    if (_client === null || _workerId === null) return;
    void _client
      .from('worker_status')
      .update({
        last_heartbeat_at: new Date().toISOString(),
        status: _isProcessing ? 'processing' : 'idle',
      })
      .eq('worker_id', _workerId);
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
  await _client
    .from('worker_status')
    .update({
      current_item_id: itemId,
      status: _isProcessing ? 'processing' : 'idle',
      last_heartbeat_at: new Date().toISOString(),
    })
    .eq('worker_id', _workerId);
}

export async function incrementProcessed(): Promise<void> {
  if (_client === null || _workerId === null) return;
  const { data } = await _client
    .from('worker_status')
    .select('items_processed')
    .eq('worker_id', _workerId)
    .single();
  if (data === null) return;
  await _client
    .from('worker_status')
    .update({ items_processed: (data.items_processed as number) + 1 })
    .eq('worker_id', _workerId);
}

export async function incrementFailed(): Promise<void> {
  if (_client === null || _workerId === null) return;
  const { data } = await _client
    .from('worker_status')
    .select('items_failed')
    .eq('worker_id', _workerId)
    .single();
  if (data === null) return;
  await _client
    .from('worker_status')
    .update({ items_failed: (data.items_failed as number) + 1 })
    .eq('worker_id', _workerId);
}
