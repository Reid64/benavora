// PostgREST silently caps any unbounded `.select()` at db.max_rows (1000 on
// this project) — a request/org with more linked rows than that gets a
// truncated result with no error, not a 4xx. See WGR-028/029/030/031/032 in
// test-evidence/_register/WIRING_GAP_REGISTER.md for the live-reproduced
// impact (up to a 99%+ undercount on real production data).
//
// Pages through a query with a stable order until a short page proves
// there's nothing left, rather than trusting the first page's row count.
// Not appropriate for id lists large enough to blow a query URL/plan budget
// — for those, push the filter into the query itself (a join/embed, or an
// aggregate) instead of building an `.in()` list client-side.
export async function selectAllPages<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await buildQuery(from, from + pageSize - 1);
    if (error) throw error;
    const page = data ?? [];
    all.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return all;
}
