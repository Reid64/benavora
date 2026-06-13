// Minimal line-level diff (LCS) used to compare two draft versions in the
// Draft Generator history panel. No external dependency - the locked stack
// ships no diff library, and drafts are plain text (applications.draft_content).

export type DiffOpType = "equal" | "add" | "remove";

export interface DiffOp {
  type: DiffOpType;
  line: string;
}

/**
 * Compute a line-level diff of `before` -> `after` via a longest-common-
 * subsequence walk. Returns an ordered list of ops: lines unchanged
 * ("equal"), removed from `before` ("remove"), or added in `after` ("add").
 */
export function diffLines(before: string, after: string): DiffOp[] {
  const a = before.split("\n");
  const b = after.split("\n");
  const n = a.length;
  const m = b.length;

  // dp[i][j] = LCS length of a[i:] and b[j:]. The matrix is sized
  // (n+1) x (m+1) and pre-filled with 0, so every access below is in-bounds
  // and defined - the non-null assertions just tell the compiler that.
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    const row = dp[i]!;
    const nextRow = dp[i + 1]!;
    for (let j = m - 1; j >= 0; j--) {
      row[j] =
        a[i] === b[j]
          ? nextRow[j + 1]! + 1
          : Math.max(nextRow[j]!, row[j + 1]!);
    }
  }

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    const ai = a[i]!;
    const bj = b[j]!;
    if (ai === bj) {
      ops.push({ type: "equal", line: ai });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ type: "remove", line: ai });
      i++;
    } else {
      ops.push({ type: "add", line: bj });
      j++;
    }
  }
  while (i < n) ops.push({ type: "remove", line: a[i++]! });
  while (j < m) ops.push({ type: "add", line: b[j++]! });
  return ops;
}

/** Count of added/removed lines, for a compact "+x / −y" summary. */
export function diffStats(ops: DiffOp[]): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const op of ops) {
    if (op.type === "add") added++;
    else if (op.type === "remove") removed++;
  }
  return { added, removed };
}
