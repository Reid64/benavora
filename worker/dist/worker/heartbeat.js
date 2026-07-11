"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.register = register;
exports.start = start;
exports.stop = stop;
exports.setProcessing = setProcessing;
exports.incrementProcessed = incrementProcessed;
exports.incrementFailed = incrementFailed;
let intervalId = null;
let _client = null;
let _workerId = null;
let _isProcessing = false;
async function register(supabase, workerId) {
    await supabase.from('worker_status').upsert({
        worker_id: workerId,
        status: 'online',
        last_heartbeat_at: new Date().toISOString(),
        started_at: new Date().toISOString(),
        items_processed: 0,
        items_failed: 0,
    }, { onConflict: 'worker_id' });
}
function start(supabase, workerId) {
    if (intervalId !== null)
        return;
    _client = supabase;
    _workerId = workerId;
    intervalId = setInterval(() => {
        if (_client === null || _workerId === null)
            return;
        void _client
            .from('worker_status')
            .update({
            last_heartbeat_at: new Date().toISOString(),
            status: _isProcessing ? 'processing' : 'idle',
        })
            .eq('worker_id', _workerId);
    }, 30_000);
}
function stop() {
    if (intervalId !== null) {
        clearInterval(intervalId);
        intervalId = null;
    }
}
async function setProcessing(itemId) {
    if (_client === null || _workerId === null)
        return;
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
async function incrementProcessed() {
    if (_client === null || _workerId === null)
        return;
    const { data } = await _client
        .from('worker_status')
        .select('items_processed')
        .eq('worker_id', _workerId)
        .single();
    if (data === null)
        return;
    await _client
        .from('worker_status')
        .update({ items_processed: data.items_processed + 1 })
        .eq('worker_id', _workerId);
}
async function incrementFailed() {
    if (_client === null || _workerId === null)
        return;
    const { data } = await _client
        .from('worker_status')
        .select('items_failed')
        .eq('worker_id', _workerId)
        .single();
    if (data === null)
        return;
    await _client
        .from('worker_status')
        .update({ items_failed: data.items_failed + 1 })
        .eq('worker_id', _workerId);
}
