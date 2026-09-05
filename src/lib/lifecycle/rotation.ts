/**
 * Making the nightly league sweep finish — and say so when it does not.
 *
 * THE PROBLEM IS SILENT TRUNCATION.
 *
 * `/api/cron/lifecycle-check` declares `maxDuration = 60` and fetched every
 * league's live rosters SEQUENTIALLY — roughly 1.5–2s of network each. Somewhere
 * around 30–40 leagues the platform kills the function mid-loop, and when it
 * does:
 *
 *   - no response is ever sent, so the run leaves no record of what it did;
 *   - the throttle prune at the end never runs;
 *   - leagues before the cutoff are reconciled and leagues after it are not —
 *     and reconciliation is what CLOSES alerts that stopped being true, so the
 *     unreached users keep stale alerts indefinitely.
 *
 * A truncated run and a complete run were indistinguishable from outside. That
 * is the failure this repository keeps finding, in a new place: a process that
 * cannot see its own limits reports success.
 *
 * THREE PARTS, IN ORDER OF HOW MUCH THEY MATTER.
 *
 * 1. **Concurrency removes the problem rather than rationing it.** The per-league
 *    work is independent — a fetch, then writes scoped to that league's own
 *    rows — so it parallelises safely. At `LIFECYCLE_CONCURRENCY` the same 60s
 *    reaches several hundred leagues instead of thirty. This is the actual fix.
 * 2. **A wall-clock budget, reported.** Concurrency raises the ceiling; it does
 *    not remove it. The run now stops itself before the platform does and states
 *    `truncated`, `processed` and `remaining`, so a sweep that did not finish is
 *    a visible fact rather than a gap.
 * 3. **Rotation, so the tail is not always the same tail.** A stable order plus
 *    a cutoff skips the same leagues every night, forever.
 *
 * WHAT ROTATION ACTUALLY GUARANTEES, stated precisely because the obvious
 * stronger claim is false: the start advances by ONE league per day, so every
 * league is guaranteed to be reached within `total` days, and in practice much
 * sooner because each night covers a whole window rather than one row. It does
 * NOT guarantee full coverage in `total / window` days — with 100 leagues and a
 * window of 30, four days reach 33, not 100. The first version of this file
 * claimed that stronger property and its own test caught it.
 *
 * A persistent cursor would give the strong guarantee. It would also mean a
 * schema change across the five schema homes plus the manual init action, for a
 * scale this deployment is nowhere near now that part 1 exists. Written down so
 * the trade is a decision rather than an oversight.
 */

/** Leave this much of `maxDuration` unused for the final writes and response. */
export const LIFECYCLE_BUDGET_MS = 50_000;

/**
 * Leagues fetched at once.
 *
 * Bounded, not unbounded: every one of these is an upstream request to Sleeper
 * or ESPN on the user's behalf, and firing hundreds simultaneously is how a
 * well-meaning cron earns a rate limit for everybody.
 */
export const LIFECYCLE_CONCURRENCY = 5;

/** Days since the epoch, in UTC. The rotation key. */
export function utcDayIndex(now: Date): number {
  return Math.floor(now.getTime() / 86_400_000);
}

/**
 * A stable order, rotated by the day so no league sits permanently in the tail.
 *
 * Sorted by id first: the database returns rows in no guaranteed order, and an
 * unstable base order would make the rotation meaningless — the tail would
 * already be shuffling, but unaccountably.
 */
export function rotateForFairness<T extends { id: string }>(items: readonly T[], now: Date): T[] {
  if (items.length === 0) return [];
  const ordered = [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const offset = utcDayIndex(now) % ordered.length;
  return [...ordered.slice(offset), ...ordered.slice(0, offset)];
}

/** The offset `rotateForFairness` used, for the run's own report. */
export function rotationOffset(total: number, now: Date): number {
  return total === 0 ? 0 : utcDayIndex(now) % total;
}

/**
 * Map over `items` with at most `limit` in flight, stopping when `shouldStop`
 * says the budget is spent.
 *
 * Results come back in input order regardless of completion order, so the run's
 * report is deterministic. `shouldStop` is consulted before each task STARTS,
 * never mid-flight: abandoning a league between its fetch and its reconciliation
 * would leave exactly the half-applied state this exists to prevent.
 */
export async function mapWithBudget<T, R>(
  items: readonly T[],
  limit: number,
  shouldStop: () => boolean,
  task: (item: T, index: number) => Promise<R>
): Promise<{ results: R[]; processed: number; stopped: boolean }> {
  const results = new Array<R>(items.length);
  let next = 0;
  let processed = 0;
  let stopped = false;

  const worker = async (): Promise<void> => {
    for (;;) {
      if (shouldStop()) {
        stopped = true;
        return;
      }
      const index = next;
      next += 1;
      if (index >= items.length) return;
      results[index] = await task(items[index]!, index);
      processed += 1;
    }
  };

  await Promise.all(
    Array.from({ length: Math.max(1, Math.min(limit, items.length || 1)) }, () => worker())
  );

  // Only the prefix that actually ran is meaningful; a stopped run leaves holes
  // at the end, and returning them as undefined would be a trap for the caller.
  // `stopped` must mean "work was left undone", not "a worker happened to check
  // the clock after the last item". Reporting truncation on a complete run would
  // be its own false alarm.
  return { results: results.slice(0, processed), processed, stopped: stopped && processed < items.length };
}
