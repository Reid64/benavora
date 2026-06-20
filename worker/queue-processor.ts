import type { SupabaseClient } from '@supabase/supabase-js';

// Full implementation: worker-005 (queue-processor prompt)

let _stopping = false;
let _idleResolve: (() => void) | null = null;

export function start(_supabase: SupabaseClient, _workerId: string): void {
  _stopping = false;
}

export function stop(): void {
  _stopping = true;
  if (_idleResolve !== null) {
    _idleResolve();
    _idleResolve = null;
  }
}

export function waitForIdle(): Promise<void> {
  if (_stopping) return Promise.resolve();
  return new Promise<void>((resolve) => {
    _idleResolve = resolve;
  });
}
