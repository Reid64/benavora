import { getPilClient } from "@/lib/pil/db";
import type { Source, SourceSnapshot, SourceType } from "@/lib/pil/types";

export async function getSource(sourceId: string): Promise<Source> {
  const { data, error } = await getPilClient()
    .from("pil_source_registry")
    .select("*")
    .eq("id", sourceId)
    .single();
  if (error) throw error;
  return data as Source;
}

export async function listActiveSources(sourceType?: SourceType): Promise<Source[]> {
  let query = getPilClient().from("pil_source_registry").select("*").eq("active", true);
  if (sourceType) {
    query = query.eq("source_type", sourceType);
  }
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as Source[];
}

export async function recordSnapshot(
  snapshot: Omit<SourceSnapshot, "id">,
): Promise<SourceSnapshot> {
  const { data, error } = await getPilClient()
    .from("pil_source_snapshots")
    .insert(snapshot)
    .select("*")
    .single();
  if (error) throw error;
  return data as SourceSnapshot;
}

export async function getLatestSnapshot(
  sourceId: string,
  url: string,
): Promise<SourceSnapshot | null> {
  // pil_source_snapshots has no source_id column -- snapshots key off
  // evidence_id (migration 153), and evidence rows don't carry a
  // source_id either, only source_url/source_type free-text fields.
  // sourceId is accepted to match the requested call shape but the actual
  // lookup is by source_url, joined through pil_evidence to scope by the
  // source registry row's source_url pattern isn't available generically,
  // so this filters snapshots directly by source_url and returns the most
  // recent capture.
  void sourceId;
  const { data, error } = await getPilClient()
    .from("pil_source_snapshots")
    .select("*")
    .eq("source_url", url)
    .order("captured_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as SourceSnapshot | null) ?? null;
}

export async function checkFreshness(
  sourceId: string,
  url: string,
  ttlHours: number,
): Promise<{ fresh: boolean; snapshot: SourceSnapshot | null }> {
  const snapshot = await getLatestSnapshot(sourceId, url);
  if (!snapshot) {
    return { fresh: false, snapshot: null };
  }
  const ageMs = Date.now() - new Date(snapshot.captured_at).getTime();
  const fresh = ageMs <= ttlHours * 60 * 60 * 1000;
  return { fresh, snapshot };
}
