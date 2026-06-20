import type { SupabaseClient } from '@supabase/supabase-js';

let intervalId: ReturnType<typeof setInterval> | null = null;
let _client: SupabaseClient | null = null;
let _workerId: string | null = null;

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
        status: 'online',
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
