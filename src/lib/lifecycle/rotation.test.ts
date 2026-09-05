import { describe, expect, it } from "vitest";
import {
  LIFECYCLE_BUDGET_MS,
  LIFECYCLE_CONCURRENCY,
  mapWithBudget,
  rotateForFairness,
  rotationOffset,
  utcDayIndex
} from "./rotation";

const leagues = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `league-${String(i).padStart(3, "0")}` }));

const day = (iso: string) => new Date(`${iso}T09:30:00.000Z`);

describe("rotateForFairness", () => {
  it("returns every item exactly once", () => {
    const out = rotateForFairness(leagues(7), day("2026-09-03"));
    expect(out).toHaveLength(7);
    expect(new Set(out.map((l) => l.id)).size).toBe(7);
  });

  it("starts at a different league on consecutive days", () => {
    const items = leagues(7);
    expect(rotateForFairness(items, day("2026-09-03"))[0]!.id).not.toBe(
      rotateForFairness(items, day("2026-09-04"))[0]!.id
    );
  });

  it("is stable within a day, so a retry re-covers the same leagues", () => {
    // A run that failed halfway is worth retrying only if the retry covers the
    // same set. Deriving the offset from the DATE, not the clock, gives that.
    const items = leagues(7);
    expect(rotateForFairness(items, new Date("2026-09-03T00:01:00.000Z")).map((l) => l.id)).toEqual(
      rotateForFairness(items, new Date("2026-09-03T23:59:00.000Z")).map((l) => l.id)
    );
  });

  it("does not depend on the order the database returned rows in", () => {
    // Without the sort, rotation is meaningless: an unstable base order already
    // shuffles the tail, and the offset would rotate a different list each time.
    const items = leagues(7);
    expect(rotateForFairness([...items].reverse(), day("2026-09-03"))).toEqual(
      rotateForFairness(items, day("2026-09-03"))
    );
  });

  it("reaches every league within `total` days — the guarantee it ACTUALLY makes", () => {
    // Stated precisely because the obvious stronger claim is false and the first
    // version of this file made it: the start advances by ONE per day, so the
    // guarantee is `total` days, not `total / window`.
    const items = leagues(40);
    const window = 12;
    const seen = new Set<string>();
    for (let d = 0; d < items.length; d += 1) {
      const now = new Date(Date.UTC(2026, 8, 3) + d * 86_400_000);
      for (const l of rotateForFairness(items, now).slice(0, window)) seen.add(l.id);
    }
    expect(seen.size).toBe(items.length);
  });

  it("does NOT reach everything in total/window days — the false claim, pinned", () => {
    // Kept as a test so nobody re-derives the optimistic version. 100 leagues,
    // 30 per night, 4 nights: 33 covered, because the start moves by one a day.
    const items = leagues(100);
    const seen = new Set<string>();
    for (let d = 0; d < 4; d += 1) {
      const now = new Date(Date.UTC(2026, 8, 3) + d * 86_400_000);
      for (const l of rotateForFairness(items, now).slice(0, 30)) seen.add(l.id);
    }
    expect(seen.size).toBe(33);
  });

  it("still beats no rotation, which reaches the same 30 forever — the canary", () => {
    const items = leagues(100);
    const seen = new Set<string>();
    for (let d = 0; d < 4; d += 1) {
      for (const l of [...items].sort((a, b) => a.id.localeCompare(b.id)).slice(0, 30)) {
        seen.add(l.id);
      }
    }
    expect(seen.size).toBe(30);
  });

  it("handles the empty and single-league cases", () => {
    expect(rotateForFairness([], day("2026-09-03"))).toEqual([]);
    expect(rotateForFairness(leagues(1), day("2026-09-03"))).toHaveLength(1);
    expect(rotationOffset(0, day("2026-09-03"))).toBe(0);
  });
});

describe("mapWithBudget", () => {
  it("processes everything when the budget is not spent", async () => {
    const out = await mapWithBudget(leagues(20), 5, () => false, async (l) => l.id);
    expect(out.processed).toBe(20);
    expect(out.stopped).toBe(false);
    expect(out.results).toHaveLength(20);
  });

  it("returns results in INPUT order, not completion order", async () => {
    // The run's report has to be deterministic. Concurrency finishes tasks out
    // of order by nature, so this is a real thing to get wrong.
    const items = leagues(10);
    const out = await mapWithBudget(items, 4, () => false, async (l, i) => {
      await new Promise((r) => setTimeout(r, (10 - i) * 2));
      return l.id;
    });
    expect(out.results).toEqual(items.map((l) => l.id));
  });

  it("never runs more than `limit` at once", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithBudget(leagues(30), 5, () => false, async (l) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 3));
      inFlight -= 1;
      return l.id;
    });
    // Bounded because each of these is an upstream request on a user's behalf.
    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1);
  });

  it("stops when the budget says so, and reports it", async () => {
    let done = 0;
    const out = await mapWithBudget(leagues(100), 4, () => done >= 12, async (l) => {
      done += 1;
      return l.id;
    });
    expect(out.stopped).toBe(true);
    expect(out.processed).toBeLessThan(100);
    expect(out.processed).toBeGreaterThanOrEqual(12);
  });

  it("never reports `stopped` on a run that finished everything", async () => {
    // The flag has to mean "work was left undone". A worker checking the clock
    // after the last item must not raise a false alarm — a truncation report
    // nobody can trust is worse than none.
    const out = await mapWithBudget(leagues(6), 3, () => true, async (l) => l.id);
    expect(out.processed).toBe(0);
    expect(out.stopped).toBe(true);

    const complete = await mapWithBudget(leagues(6), 3, () => false, async (l) => l.id);
    expect(complete.stopped).toBe(false);

    const empty = await mapWithBudget([], 3, () => true, async () => 1);
    expect(empty.stopped).toBe(false);
    expect(empty.processed).toBe(0);
  });

  it("returns no holes — every returned slot really ran", async () => {
    // `results.slice(0, processed)` is only safe if the completed set is a
    // contiguous prefix. Indices are handed out in order and Promise.all waits
    // for every task that started, so it is — this pins that.
    const out = await mapWithBudget(leagues(50), 6, () => false, async (l, i) => {
      await new Promise((r) => setTimeout(r, i % 3));
      return l.id;
    });
    expect(out.results.every((r) => typeof r === "string")).toBe(true);
    expect(out.results).toHaveLength(out.processed);
  });

  it("has no holes even when STOPPING while later indices finish first", async () => {
    // Raised in security review 2026-09-04 as a suspected defect: "worker 3
    // finishing first yields slice(0,1) = results[0], still undefined".
    //
    // It does not, and the reason is worth writing down rather than
    // re-deriving. That describes an INTERMEDIATE state. Indices are handed out
    // strictly in order, and `await Promise.all` waits for every task that
    // STARTED — so by the time the slice happens, every handed-out index below
    // `items.length` has completed and the filled set is a contiguous prefix.
    // `processed` equals exactly that prefix length.
    //
    // Pinned across many trials with later indices deliberately resolving
    // first, because the failure it guards against would be intermittent.
    for (let trial = 0; trial < 40; trial += 1) {
      let done = 0;
      const items = Array.from({ length: 60 }, (_, i) => ({ id: `x${i}` }));
      const out = await mapWithBudget(items, 8, () => done >= 17, async (l, i) => {
        await new Promise((r) => setTimeout(r, (60 - i) % 7));
        done += 1;
        return l.id;
      });
      expect(out.results.length, `trial ${trial}`).toBe(out.processed);
      expect(out.results.some((r) => r === undefined), `trial ${trial} has a hole`).toBe(false);
    }
  });

  it("propagates a task failure rather than swallowing it", async () => {
    await expect(
      mapWithBudget(leagues(5), 2, () => false, async (_l, i) => {
        if (i === 2) throw new Error("upstream exploded");
        return i;
      })
    ).rejects.toThrow("upstream exploded");
  });
});

describe("the budget and concurrency are sized against the route", () => {
  it("leaves the run room to report itself", () => {
    // `maxDuration = 60` in the route. The gap is what the final writes and the
    // JSON response get — without it, stopping early would still be killed
    // before it could say it stopped early.
    expect(LIFECYCLE_BUDGET_MS).toBeLessThan(60_000);
    expect(60_000 - LIFECYCLE_BUDGET_MS).toBeGreaterThanOrEqual(5_000);
  });

  it("keeps concurrency bounded and modest", () => {
    expect(LIFECYCLE_CONCURRENCY).toBeGreaterThan(1);
    expect(LIFECYCLE_CONCURRENCY).toBeLessThanOrEqual(10);
  });

  it("derives the day index in UTC, not local time", () => {
    // A local-time index would rotate at a different moment per deployment
    // region, and twice on a DST boundary.
    expect(utcDayIndex(new Date("2026-09-03T00:00:00.000Z"))).toBe(
      utcDayIndex(new Date("2026-09-03T23:59:59.000Z"))
    );
    expect(utcDayIndex(new Date("2026-09-04T00:00:00.000Z"))).toBe(
      utcDayIndex(new Date("2026-09-03T00:00:00.000Z")) + 1
    );
  });
});
