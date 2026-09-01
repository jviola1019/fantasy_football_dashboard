/**
 * A stable fingerprint of the rows a result was scored on.
 *
 * Audit 2026-08-22, P2-5. Two reports are comparable only when this value
 * matches: identical fingerprints mean identical inputs, so a difference in the
 * numbers is a difference in the model rather than in the data underneath it.
 *
 * Shared (S7) rather than copied. `scripts/brier-backtest.ts` owned the only
 * implementation, and `scripts/fit-weekly-prob.ts` needed the same value to
 * prove that the coefficients it freezes were fitted on the same rows the
 * published Brier and ECE describe. A second implementation reached a different
 * answer on the first run — not because the data differed, but because it hashed
 * differently. A comparability check that two callers compute differently is
 * worse than none, because it looks authoritative while comparing nothing.
 *
 * FNV-1a over the sorted keys. Order-independent by construction, so a
 * re-ordered snapshot is still recognised as the same data.
 */
export function fingerprintRows(keys: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const key of [...keys].sort()) {
    for (let i = 0; i < key.length; i += 1) {
      h ^= key.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  }
  return h.toString(16).padStart(8, "0");
}

/**
 * The key form the prospective Brier snapshot is fingerprinted by. Declared once
 * so the backtest and the coefficient fit cannot describe "the same rows"
 * differently.
 */
export function prospectiveRowKey(r: {
  player_id: string;
  week: number;
  proj_pts_ppr: number;
  actual_pts_ppr: number;
}): string {
  return `${r.player_id}|${r.week}|${r.proj_pts_ppr}|${r.actual_pts_ppr}`;
}
