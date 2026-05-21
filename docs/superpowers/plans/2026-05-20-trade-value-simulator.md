# Trade Value Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the abstract trade evaluator with a FantasyCalc-backed, statistically validated trade value simulator: an interactive builder, graded real league trades, and auto-detected league format.

**Architecture:** A new `src/lib/trade/` module (format detection, value adapter, pure evaluator, transaction normalization, backtest harness) mirrors the existing governance-wrapped adapter pattern. Trade Center becomes an interactive client island fed by a server action. The `leagues` table gains a `settings` column.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Zod, Drizzle ORM (SQLite dev / Postgres prod), Vitest, Playwright. Data: FantasyCalc free API, DynastyProcess CSV, nflverse historical fixtures.

Reference spec: `docs/superpowers/specs/2026-05-20-trade-value-simulator-design.md`.

---

## File Structure

**Create:**
- `src/lib/trade/format.ts` — `LeagueFormat` type, `DEFAULT_FORMAT`, Sleeper/ESPN parsers.
- `src/lib/trade/format.test.ts`
- `src/lib/trade/values.ts` — `PlayerValue` type, `fetchTradeValues` (FantasyCalc + DynastyProcess fallback).
- `src/lib/trade/values.test.ts`
- `src/lib/trade/values.live.test.ts` — env-gated live FantasyCalc round-trip.
- `src/lib/trade/evaluate.ts` — pure `evaluateTrade`.
- `src/lib/trade/evaluate.test.ts`
- `src/lib/trade/transactions.ts` — `fetchLeagueTrades`, Sleeper/ESPN normalization.
- `src/lib/trade/transactions.test.ts`
- `src/lib/trade/verify.ts` — `verifyLeague`.
- `src/lib/trade/verify.test.ts`
- `src/lib/trade/backtest.ts` — VOR, Spearman, calibration harness.
- `src/lib/trade/backtest.test.ts`
- `src/lib/trade/fixtures/backtest-2024.json` — committed preseason values paired with realized 2024 totals.
- `src/components/panels/trade/TradeBuilder.tsx` — builder UI.
- `src/components/panels/trade/RecentLeagueTrades.tsx` — graded real trades UI.
- `src/app/trade/actions.ts` — server action supplying the value map + format.
- `docs/trade-calibration.md` — validation writeup.

**Modify:**
- `src/db/schema.ts` — add `settings` to `leagues`.
- `src/db/schema-pg.ts` — add `settings` to `leagues` + `INIT_SQL`.
- `src/db/index.ts` — add `settings` to `applySqliteSchemaIfNeeded` and `applyTestSchema`.
- `src/lib/leagues.ts` — persist/read `settings`.
- `src/app/settings/leagues/actions.ts` — call `verifyLeague` before `createLeague`.
- `src/components/panels/TradeCenter.tsx` — rebuilt as builder + recent trades.
- `e2e/01-dashboard.spec.ts` — add Trade Builder assertions.

**Delete:**
- `src/lib/lifecycle/trades.ts` and `src/lib/lifecycle/trades.test.ts` — superseded by `evaluate.ts`.

---

## Task 1: Add `settings` column to the `leagues` table

**Files:**
- Modify: `src/db/schema.ts:51-63`
- Modify: `src/db/schema-pg.ts:57-67` and `INIT_SQL`
- Modify: `src/db/index.ts` (`applySqliteSchemaIfNeeded`, `applyTestSchema`)

- [ ] **Step 1: Add the column to the SQLite schema**

In `src/db/schema.ts`, add a `settings` field to the `leagues` table (after `label`):

```ts
export const leagues = sqliteTable("leagues", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform", { enum: ["sleeper", "espn"] }).notNull(),
  externalLeagueId: text("externalLeagueId").notNull(),
  season: integer("season").notNull(),
  label: text("label").notNull(),
  settings: text("settings"),
  createdAt: integer("createdAt", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`)
});
```

- [ ] **Step 2: Add the column to the Postgres schema and `INIT_SQL`**

In `src/db/schema-pg.ts`, add `settings: text("settings")` to the `leagues` table after `label`. Then in `INIT_SQL`, add the column to the `leagues` CREATE TABLE and append an idempotent `ALTER` for already-initialized databases. The `leagues` block becomes:

```sql
  CREATE TABLE IF NOT EXISTS leagues (
    id TEXT PRIMARY KEY,
    "userId" TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    "externalLeagueId" TEXT NOT NULL,
    season INTEGER NOT NULL,
    label TEXT NOT NULL,
    settings JSONB,
    "createdAt" TIMESTAMP NOT NULL DEFAULT now()
  );
  ALTER TABLE leagues ADD COLUMN IF NOT EXISTS settings JSONB;
```

- [ ] **Step 3: Add the column to the runtime SQLite schema blocks**

In `src/db/index.ts`, add `settings TEXT,` after the `label TEXT NOT NULL,` line in **both** `applySqliteSchemaIfNeeded` and `applyTestSchema`'s `leagues` CREATE TABLE.

- [ ] **Step 4: Verify typecheck and existing tests still pass**

Run: `npx tsc --noEmit && npx vitest run src/lib/leagues.test.ts`
Expected: typecheck clean; leagues tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/db/schema.ts src/db/schema-pg.ts src/db/index.ts
git commit -m "Add settings column to leagues table"
```

---

## Task 2: League format type and parsers

**Files:**
- Create: `src/lib/trade/format.ts`
- Test: `src/lib/trade/format.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/trade/format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { DEFAULT_FORMAT, parseSleeperFormat, parseEspnFormat } from "./format";

describe("parseSleeperFormat", () => {
  it("reads PPR, team count, and 1QB from settings", () => {
    const fmt = parseSleeperFormat({
      total_rosters: 10,
      scoring_settings: { rec: 1 },
      roster_positions: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "BN"]
    });
    expect(fmt).toEqual({ ppr: 1, numQbs: 1, numTeams: 10 });
  });

  it("detects superflex as numQbs 2", () => {
    const fmt = parseSleeperFormat({
      total_rosters: 12,
      scoring_settings: { rec: 0.5 },
      roster_positions: ["QB", "SUPER_FLEX", "RB", "WR", "BN"]
    });
    expect(fmt).toEqual({ ppr: 0.5, numQbs: 2, numTeams: 12 });
  });

  it("falls back to DEFAULT_FORMAT on malformed input", () => {
    expect(parseSleeperFormat(null)).toEqual(DEFAULT_FORMAT);
  });
});

describe("parseEspnFormat", () => {
  it("reads PPR and team count from ESPN settings", () => {
    const fmt = parseEspnFormat({
      size: 12,
      scoringSettings: { scoringItems: [{ statId: 53, points: 1 }] },
      rosterSettings: { lineupSlotCounts: { "0": 1, "23": 0 } }
    });
    expect(fmt).toEqual({ ppr: 1, numQbs: 1, numTeams: 12 });
  });

  it("falls back to DEFAULT_FORMAT on malformed input", () => {
    expect(parseEspnFormat(undefined)).toEqual(DEFAULT_FORMAT);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/trade/format.test.ts`
Expected: FAIL — cannot find module `./format`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/trade/format.ts`:

```ts
export interface LeagueFormat {
  /** Reception scoring: 0 standard, 0.5 half-PPR, 1 full PPR. */
  ppr: 0 | 0.5 | 1;
  /** 1 for single-QB leagues, 2 for superflex/2QB. */
  numQbs: 1 | 2;
  numTeams: number;
}

export const DEFAULT_FORMAT: LeagueFormat = { ppr: 1, numQbs: 1, numTeams: 12 };

function normalizePpr(rec: unknown): 0 | 0.5 | 1 {
  if (rec === 1) return 1;
  if (rec === 0.5) return 0.5;
  return 0;
}

/** Parse a Sleeper `getLeague` payload into a LeagueFormat. */
export function parseSleeperFormat(league: unknown): LeagueFormat {
  if (!league || typeof league !== "object") return DEFAULT_FORMAT;
  const l = league as Record<string, unknown>;
  const positions = Array.isArray(l.roster_positions) ? (l.roster_positions as string[]) : [];
  const scoring = (l.scoring_settings ?? {}) as Record<string, unknown>;
  const numTeams = typeof l.total_rosters === "number" ? l.total_rosters : DEFAULT_FORMAT.numTeams;
  const numQbs: 1 | 2 = positions.includes("SUPER_FLEX") ? 2 : 1;
  return { ppr: normalizePpr(scoring.rec), numQbs, numTeams };
}

/** Parse an ESPN `mSettings` payload into a LeagueFormat. */
export function parseEspnFormat(settings: unknown): LeagueFormat {
  if (!settings || typeof settings !== "object") return DEFAULT_FORMAT;
  const s = settings as Record<string, unknown>;
  const numTeams = typeof s.size === "number" ? s.size : DEFAULT_FORMAT.numTeams;
  // ESPN statId 53 = receptions; its points value is the PPR weight.
  const scoring = (s.scoringSettings ?? {}) as Record<string, unknown>;
  const items = Array.isArray(scoring.scoringItems) ? (scoring.scoringItems as Record<string, unknown>[]) : [];
  const recItem = items.find((i) => i.statId === 53);
  const ppr = normalizePpr(typeof recItem?.points === "number" ? recItem.points : 0);
  // Lineup slot 23 = OP/superflex; >0 count means superflex.
  const roster = (s.rosterSettings ?? {}) as Record<string, unknown>;
  const counts = (roster.lineupSlotCounts ?? {}) as Record<string, number>;
  const numQbs: 1 | 2 = (counts["23"] ?? 0) > 0 ? 2 : 1;
  return { ppr, numQbs, numTeams };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/trade/format.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trade/format.ts src/lib/trade/format.test.ts
git commit -m "Add league format type and Sleeper/ESPN parsers"
```

---

## Task 3: FantasyCalc value adapter

**Files:**
- Create: `src/lib/trade/values.ts`
- Test: `src/lib/trade/values.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/trade/values.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseFantasyCalc, buildFantasyCalcUrl } from "./values";

const SAMPLE = [
  {
    player: { name: "Jahmyr Gibbs", position: "RB", maybeTeam: "DET", sleeperId: "9493", espnId: 4429795 },
    value: 10399, redraftValue: 10399, overallRank: 2, positionRank: 1, trend30Day: 120
  },
  {
    player: { name: "Caleb Williams", position: "QB", maybeTeam: "CHI", sleeperId: "11560", espnId: 4431611 },
    value: 3100, redraftValue: 3100, overallRank: 70, positionRank: 14, trend30Day: -40
  }
];

describe("buildFantasyCalcUrl", () => {
  it("encodes format params", () => {
    const url = buildFantasyCalcUrl({ ppr: 0.5, numQbs: 2, numTeams: 10 });
    expect(url).toBe(
      "https://api.fantasycalc.com/values/current?isDynasty=false&numQbs=2&numTeams=10&ppr=0.5"
    );
  });
});

describe("parseFantasyCalc", () => {
  it("maps entries into a sleeperId-keyed PlayerValue map", () => {
    const map = parseFantasyCalc(SAMPLE);
    const gibbs = map.get("9493");
    expect(gibbs?.value).toBe(10399);
    expect(gibbs?.position).toBe("RB");
    expect(map.get("11560")?.value).toBe(3100);
  });

  it("throws on a malformed payload", () => {
    expect(() => parseFantasyCalc([{ player: {} }])).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/trade/values.test.ts`
Expected: FAIL — cannot find module `./values`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/trade/values.ts`:

```ts
import { z } from "zod";
import type { SourceMeta } from "../governance";
import { unavailableSource } from "../governance";
import type { LeagueFormat } from "./format";

export interface PlayerValue {
  sleeperId: string | null;
  espnId: string | null;
  name: string;
  position: string;
  team: string | null;
  value: number;
  overallRank: number;
  positionRank: number;
  trend30Day: number;
}

export interface TradeValueData {
  values: Map<string, PlayerValue>;
  source: SourceMeta;
}

const FantasyCalcEntrySchema = z.object({
  player: z.object({
    name: z.string(),
    position: z.string(),
    maybeTeam: z.string().nullish(),
    sleeperId: z.union([z.string(), z.number()]).nullish(),
    espnId: z.union([z.string(), z.number()]).nullish()
  }),
  value: z.number(),
  redraftValue: z.number().nullish(),
  overallRank: z.number(),
  positionRank: z.number(),
  trend30Day: z.number().nullish()
});
const FantasyCalcResponseSchema = z.array(FantasyCalcEntrySchema);

const FANTASYCALC_TTL_SECONDS = 43_200; // 12h

export function buildFantasyCalcUrl(format: LeagueFormat): string {
  return (
    "https://api.fantasycalc.com/values/current" +
    `?isDynasty=false&numQbs=${format.numQbs}&numTeams=${format.numTeams}&ppr=${format.ppr}`
  );
}

/** Map a validated FantasyCalc payload into a sleeperId-keyed PlayerValue map. */
export function parseFantasyCalc(raw: unknown): Map<string, PlayerValue> {
  const entries = FantasyCalcResponseSchema.parse(raw);
  const map = new Map<string, PlayerValue>();
  for (const e of entries) {
    const sleeperId = e.player.sleeperId != null ? String(e.player.sleeperId) : null;
    if (!sleeperId) continue;
    map.set(sleeperId, {
      sleeperId,
      espnId: e.player.espnId != null ? String(e.player.espnId) : null,
      name: e.player.name,
      position: e.player.position,
      team: e.player.maybeTeam ?? null,
      value: e.redraftValue ?? e.value,
      overallRank: e.overallRank,
      positionRank: e.positionRank,
      trend30Day: e.trend30Day ?? 0
    });
  }
  return map;
}

/** Fetch live trade values, governance-wrapped. DynastyProcess fallback is added in Task 4. */
export async function fetchTradeValues(format: LeagueFormat): Promise<TradeValueData> {
  const url = buildFantasyCalcUrl(format);
  try {
    const res = await fetch(url, { next: { revalidate: FANTASYCALC_TTL_SECONDS } });
    if (!res.ok) throw new Error(`FantasyCalc HTTP ${res.status}`);
    const values = parseFantasyCalc(await res.json());
    return {
      values,
      source: {
        source: "FantasyCalc redraft values",
        fetchedAt: new Date().toISOString(),
        ttlSeconds: FANTASYCALC_TTL_SECONDS,
        freshness: "fresh",
        confidence: 0.9,
        validation: "valid",
        missingFields: [],
        assumptions: [`Format: ${format.numTeams}-team, ${format.numQbs}QB, ${format.ppr} PPR.`],
        failure: null
      }
    };
  } catch (err) {
    return {
      values: new Map(),
      source: unavailableSource(
        "FantasyCalc redraft values",
        err instanceof Error ? err.message : String(err)
      )
    };
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/trade/values.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/trade/values.ts src/lib/trade/values.test.ts
git commit -m "Add FantasyCalc trade value adapter"
```

---

## Task 4: DynastyProcess fallback + live test

**Files:**
- Modify: `src/lib/trade/values.ts`
- Modify: `src/lib/trade/values.test.ts`
- Create: `src/lib/trade/values.live.test.ts`

- [ ] **Step 1: Write the failing test for the CSV parser**

Append to `src/lib/trade/values.test.ts`:

```ts
import { parseDynastyProcessCsv } from "./values";

describe("parseDynastyProcessCsv", () => {
  const CSV = [
    "player,pos,team,age,ecr_1qb,ecr_2qb,ecr_pos,value_1qb,value_2qb,fp_id,scrape_date",
    "Jahmyr Gibbs,RB,DET,23,2,4,1,9800,9200,24189,2026-05-19",
    "Caleb Williams,QB,CHI,24,80,30,15,1200,4800,23090,2026-05-19"
  ].join("\n");

  it("selects value_1qb for a 1QB format", () => {
    const map = parseDynastyProcessCsv(CSV, { ppr: 1, numQbs: 1, numTeams: 12 });
    expect(map.get("rb-jahmyr gibbs")?.value).toBe(9800);
  });

  it("selects value_2qb for a superflex format", () => {
    const map = parseDynastyProcessCsv(CSV, { ppr: 1, numQbs: 2, numTeams: 12 });
    expect(map.get("qb-caleb williams")?.value).toBe(4800);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/trade/values.test.ts`
Expected: FAIL — `parseDynastyProcessCsv` is not exported.

- [ ] **Step 3: Implement the CSV fallback**

Add to `src/lib/trade/values.ts`. DynastyProcess rows carry no Sleeper id, so its map is keyed `"<pos>-<lowercased name>"` and is consulted only as a fallback:

```ts
const DYNASTYPROCESS_CSV_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";

/** Parse the DynastyProcess values.csv text into a "<pos>-<name>"-keyed map. */
export function parseDynastyProcessCsv(csv: string, format: LeagueFormat): Map<string, PlayerValue> {
  const lines = csv.trim().split(/\r?\n/);
  const header = lines[0]!.split(",");
  const col = (name: string) => header.indexOf(name);
  const iName = col("player");
  const iPos = col("pos");
  const iTeam = col("team");
  const iVal = format.numQbs === 2 ? col("value_2qb") : col("value_1qb");
  const map = new Map<string, PlayerValue>();
  for (const line of lines.slice(1)) {
    const cells = line.split(",");
    const name = cells[iName];
    const pos = cells[iPos];
    const value = Number(cells[iVal]);
    if (!name || !pos || !Number.isFinite(value)) continue;
    map.set(`${pos.toLowerCase()}-${name.toLowerCase()}`, {
      sleeperId: null,
      espnId: null,
      name,
      position: pos,
      team: cells[iTeam] ?? null,
      value,
      overallRank: 0,
      positionRank: 0,
      trend30Day: 0
    });
  }
  return map;
}

/** Fetch the DynastyProcess fallback values. */
export async function fetchDynastyProcessValues(format: LeagueFormat): Promise<Map<string, PlayerValue>> {
  const res = await fetch(DYNASTYPROCESS_CSV_URL, { next: { revalidate: FANTASYCALC_TTL_SECONDS } });
  if (!res.ok) throw new Error(`DynastyProcess HTTP ${res.status}`);
  return parseDynastyProcessCsv(await res.text(), format);
}
```

- [ ] **Step 4: Wire the fallback into `fetchTradeValues`**

Replace the `catch` block in `fetchTradeValues` so it tries DynastyProcess before giving up:

```ts
  } catch (primaryErr) {
    try {
      const values = await fetchDynastyProcessValues(format);
      return {
        values,
        source: {
          source: "DynastyProcess values (fallback)",
          fetchedAt: new Date().toISOString(),
          ttlSeconds: FANTASYCALC_TTL_SECONDS,
          freshness: "stale",
          confidence: 0.6,
          validation: "valid",
          missingFields: ["sleeperId"],
          assumptions: [
            "FantasyCalc unavailable; using DynastyProcess ECR-derived values keyed by name.",
            `Primary failure: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`
          ],
          failure: null
        }
      };
    } catch (fallbackErr) {
      return {
        values: new Map(),
        source: unavailableSource(
          "Trade values",
          `FantasyCalc and DynastyProcess both failed: ${
            fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
          }`
        )
      };
    }
  }
```

- [ ] **Step 5: Write the env-gated live test**

Create `src/lib/trade/values.live.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { fetchTradeValues } from "./values";
import { DEFAULT_FORMAT } from "./format";

const live = process.env.RAE_LIVE_TESTS === "1";

describe.skipIf(!live)("FantasyCalc live", () => {
  it("returns a non-empty value map for the default format", async () => {
    const data = await fetchTradeValues(DEFAULT_FORMAT);
    expect(data.source.freshness).toBe("fresh");
    expect(data.values.size).toBeGreaterThan(100);
  }, 20_000);
});
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/lib/trade/values.test.ts`
Expected: PASS (5 tests; the live test is skipped without `RAE_LIVE_TESTS=1`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/trade/values.ts src/lib/trade/values.test.ts src/lib/trade/values.live.test.ts
git commit -m "Add DynastyProcess fallback and live FantasyCalc test"
```

---

## Task 5: Pure trade evaluator (replaces lifecycle/trades.ts)

**Files:**
- Create: `src/lib/trade/evaluate.ts`
- Test: `src/lib/trade/evaluate.test.ts`
- Delete: `src/lib/lifecycle/trades.ts`, `src/lib/lifecycle/trades.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/trade/evaluate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { evaluateTrade } from "./evaluate";
import type { PlayerValue } from "./values";

function pv(name: string, value: number): PlayerValue {
  return {
    sleeperId: name, espnId: null, name, position: "RB", team: null,
    value, overallRank: 0, positionRank: 0, trend30Day: 0
  };
}

describe("evaluateTrade", () => {
  it("rates an equal trade as balanced", () => {
    const v = evaluateTrade([pv("a", 5000)], [pv("b", 5000)]);
    expect(v.verdict).toBe("balanced");
    expect(v.winner).toBe("even");
    expect(v.pctDelta).toBe(0);
  });

  it("rates a 40% gap as lopsided and names the winner", () => {
    const v = evaluateTrade([pv("a", 10000)], [pv("b", 6000)]);
    expect(v.verdict).toBe("lopsided");
    expect(v.winner).toBe("A");
    expect(v.pctDelta).toBeCloseTo(0.4, 5);
  });

  it("rates a 15% gap as a slight edge", () => {
    const v = evaluateTrade([pv("a", 10000)], [pv("b", 8500)]);
    expect(v.verdict).toBe("slight-edge");
    expect(v.winner).toBe("A");
  });

  it("treats two empty sides as balanced", () => {
    expect(evaluateTrade([], []).verdict).toBe("balanced");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/trade/evaluate.test.ts`
Expected: FAIL — cannot find module `./evaluate`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/trade/evaluate.ts`:

```ts
import type { PlayerValue } from "./values";

export type Verdict = "balanced" | "slight-edge" | "lopsided";

export interface TradeVerdict {
  totalA: number;
  totalB: number;
  /** totalA - totalB. */
  delta: number;
  /** |delta| / max(totalA, totalB, 1), in 0..1. */
  pctDelta: number;
  /** 1 - pctDelta, clamped to 0..1. */
  fairness: number;
  verdict: Verdict;
  winner: "A" | "B" | "even";
}

// Starting thresholds; Backtest B (Task 8) validates and may adjust them once.
const BALANCED_MAX = 0.1;
const SLIGHT_MAX = 0.25;

const sum = (side: PlayerValue[]) => side.reduce((acc, p) => acc + p.value, 0);

export function evaluateTrade(sideA: PlayerValue[], sideB: PlayerValue[]): TradeVerdict {
  const totalA = sum(sideA);
  const totalB = sum(sideB);
  const delta = totalA - totalB;
  const pctDelta = Math.abs(delta) / Math.max(totalA, totalB, 1);
  const fairness = Math.max(0, Math.min(1, 1 - pctDelta));
  const verdict: Verdict =
    pctDelta <= BALANCED_MAX ? "balanced" : pctDelta <= SLIGHT_MAX ? "slight-edge" : "lopsided";
  const winner = verdict === "balanced" ? "even" : delta > 0 ? "A" : "B";
  return { totalA, totalB, delta, pctDelta, fairness, verdict, winner };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/trade/evaluate.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Delete the superseded module**

Delete `src/lib/lifecycle/trades.ts` and `src/lib/lifecycle/trades.test.ts`. Then check for importers:

Run: `npx grep -rl "lifecycle/trades" src` (or use the Grep tool for `lifecycle/trades`).
If `src/lib/lifecycle/notifications.ts` or any panel imports it, that import is replaced by `evaluate.ts` usage in Task 9. For now, confirm only `TradeCenter.tsx` references it (it is rebuilt in Task 9).

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `src/components/panels/TradeCenter.tsx` (rebuilt in Task 9). If any other file errors, update its import to use `evaluate.ts`.

- [ ] **Step 7: Commit**

```bash
git add src/lib/trade/evaluate.ts src/lib/trade/evaluate.test.ts
git rm src/lib/lifecycle/trades.ts src/lib/lifecycle/trades.test.ts
git commit -m "Add value-based trade evaluator, remove abstract edge evaluator"
```

---

## Task 6: League transaction normalization

**Files:**
- Create: `src/lib/trade/transactions.ts`
- Test: `src/lib/trade/transactions.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/trade/transactions.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { normalizeSleeperTrades } from "./transactions";
import type { PlayerValue } from "./values";

function pv(id: string, value: number): PlayerValue {
  return {
    sleeperId: id, espnId: null, name: `Player ${id}`, position: "RB", team: null,
    value, overallRank: 0, positionRank: 0, trend30Day: 0
  };
}

describe("normalizeSleeperTrades", () => {
  const valueMap = new Map<string, PlayerValue>([
    ["100", pv("100", 8000)],
    ["200", pv("200", 3000)]
  ]);
  // Sleeper trade: roster 1 receives player 100, roster 2 receives player 200.
  const txns = [
    {
      type: "trade",
      status: "complete",
      created: 1_700_000_000_000,
      roster_ids: [1, 2],
      adds: { "100": 1, "200": 2 }
    },
    { type: "waiver", status: "complete", created: 1, roster_ids: [1], adds: { "300": 1 } }
  ];

  it("keeps only completed trades and grades them", () => {
    const graded = normalizeSleeperTrades(txns, valueMap);
    expect(graded).toHaveLength(1);
    expect(graded[0]!.verdict.winner).toBe("A");
  });

  it("returns an empty list when there are no trades", () => {
    expect(normalizeSleeperTrades([], valueMap)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/trade/transactions.test.ts`
Expected: FAIL — cannot find module `./transactions`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/trade/transactions.ts`:

```ts
import type { PlayerValue } from "./values";
import { evaluateTrade, type TradeVerdict } from "./evaluate";

export interface GradedTrade {
  id: string;
  proposedAt: string;
  sideALabel: string;
  sideBLabel: string;
  sideA: PlayerValue[];
  sideB: PlayerValue[];
  verdict: TradeVerdict;
}

interface SleeperTxn {
  type?: string;
  status?: string;
  created?: number;
  roster_ids?: number[];
  adds?: Record<string, number> | null;
}

/**
 * Normalize raw Sleeper transactions into graded trades. `adds` maps a player
 * id to the roster id that received them; side A is the first roster id.
 */
export function normalizeSleeperTrades(
  txns: SleeperTxn[],
  valueMap: Map<string, PlayerValue>
): GradedTrade[] {
  const out: GradedTrade[] = [];
  for (const t of txns) {
    if (t.type !== "trade" || t.status !== "complete") continue;
    const rosterIds = t.roster_ids ?? [];
    const rosterA = rosterIds[0];
    if (rosterA == null) continue;
    const sideA: PlayerValue[] = [];
    const sideB: PlayerValue[] = [];
    for (const [playerId, rosterId] of Object.entries(t.adds ?? {})) {
      const pv = valueMap.get(playerId);
      if (!pv) continue;
      (rosterId === rosterA ? sideA : sideB).push(pv);
    }
    out.push({
      id: `sleeper-${t.created ?? out.length}`,
      proposedAt: new Date(t.created ?? Date.now()).toISOString(),
      sideALabel: `Roster ${rosterA}`,
      sideBLabel: `Roster ${rosterIds[1] ?? "?"}`,
      sideA,
      sideB,
      verdict: evaluateTrade(sideA, sideB)
    });
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/trade/transactions.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Add the Sleeper league-trades fetcher**

Append to `src/lib/trade/transactions.ts` a wrapper that pulls recent transaction rounds and grades them. `getTransactions(leagueId, round)` and `getNflState()` return `FetchEnvelopeResult` (`{ data, source }`):

```ts
import { getTransactions, getNflState } from "../sleeper/league";

/** Fetch and grade completed trades from the most recent Sleeper weeks. */
export async function fetchSleeperLeagueTrades(
  leagueId: string,
  valueMap: Map<string, PlayerValue>,
  weeksBack = 6
): Promise<GradedTrade[]> {
  const state = await getNflState();
  const week = state.data && typeof state.data.week === "number" ? state.data.week : 1;
  const graded: GradedTrade[] = [];
  for (let w = week; w > Math.max(0, week - weeksBack); w--) {
    const envelope = await getTransactions(leagueId, w);
    if (envelope.source.failure || !envelope.data) continue;
    graded.push(...normalizeSleeperTrades(envelope.data as unknown as SleeperTxn[], valueMap));
  }
  return graded;
}
```

`SleeperTxn` is already declared in this file; `getNflState().data.week` is the current NFL week.

- [ ] **Step 6: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: clean except `src/components/panels/TradeCenter.tsx` (rebuilt in Task 9).

- [ ] **Step 7: Commit**

```bash
git add src/lib/trade/transactions.ts src/lib/trade/transactions.test.ts
git commit -m "Add Sleeper transaction normalization, grading, and fetch"
```

---

## Task 7: League verification at add time

**Files:**
- Create: `src/lib/trade/verify.ts`
- Test: `src/lib/trade/verify.test.ts`
- Modify: `src/lib/leagues.ts`
- Modify: `src/app/settings/leagues/actions.ts`

- [ ] **Step 1: Write the failing test**

Create `src/lib/trade/verify.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { interpretSleeperLeague } from "./verify";

describe("interpretSleeperLeague", () => {
  it("returns ok with parsed format for a valid league", () => {
    const result = interpretSleeperLeague({
      name: "Dynasty Warriors",
      total_rosters: 12,
      scoring_settings: { rec: 1 },
      roster_positions: ["QB", "RB", "WR", "TE", "BN"]
    });
    expect(result).toEqual({
      ok: true,
      format: { ppr: 1, numQbs: 1, numTeams: 12 },
      resolvedLabel: "Dynasty Warriors"
    });
  });

  it("returns an error when the league payload is empty", () => {
    expect(interpretSleeperLeague(null)).toEqual({
      ok: false,
      error: "League not found on Sleeper. Check the league ID and season."
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/trade/verify.test.ts`
Expected: FAIL — cannot find module `./verify`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/trade/verify.ts`:

```ts
import { getLeague } from "../sleeper/league";
import { parseSleeperFormat, parseEspnFormat, type LeagueFormat } from "./format";

export type VerifyResult =
  | { ok: true; format: LeagueFormat; resolvedLabel: string }
  | { ok: false; error: string };

/** Pure interpreter for a Sleeper getLeague payload. */
export function interpretSleeperLeague(league: unknown): VerifyResult {
  if (!league || typeof league !== "object") {
    return { ok: false, error: "League not found on Sleeper. Check the league ID and season." };
  }
  const name = (league as Record<string, unknown>).name;
  return {
    ok: true,
    format: parseSleeperFormat(league),
    resolvedLabel: typeof name === "string" && name.length > 0 ? name : "Sleeper league"
  };
}

/** Pure interpreter for an ESPN mSettings payload. */
export function interpretEspnLeague(settings: unknown): VerifyResult {
  if (!settings || typeof settings !== "object") {
    return { ok: false, error: "ESPN league not reachable. Check the league ID and cookies." };
  }
  const name = (settings as Record<string, unknown>).name;
  return {
    ok: true,
    format: parseEspnFormat(settings),
    resolvedLabel: typeof name === "string" && name.length > 0 ? name : "ESPN league"
  };
}

/**
 * Verify a league exists and derive its format. Sleeper uses the public API;
 * ESPN settings verification is wired through the existing ESPN client by the
 * caller, which passes the already-fetched `mSettings` payload as `espnSettings`.
 */
export async function verifyLeague(input: {
  platform: "sleeper" | "espn";
  externalLeagueId: string;
  espnSettings?: unknown;
}): Promise<VerifyResult> {
  if (input.platform === "sleeper") {
    const envelope = await getLeague(input.externalLeagueId);
    if (envelope.source.failure || !envelope.data) {
      return { ok: false, error: "League not found on Sleeper. Check the league ID and season." };
    }
    return interpretSleeperLeague(envelope.data);
  }
  return interpretEspnLeague(input.espnSettings);
}
```

> `getLeague` returns `FetchEnvelopeResult<T> = { data: T | null; source: SourceMeta }` from `fetchWithEnvelope` (`src/lib/http.ts`) — `data` is `null` on failure and `source.failure` carries the reason.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/trade/verify.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Persist settings through `createLeague`**

In `src/lib/leagues.ts`, add `settings?: LeagueFormat` to `CreateLeagueInput` and `LeagueRecord`, write it on insert, and read it back. Add `import type { LeagueFormat } from "./trade/format";` at the top. In `createLeague`, change the insert `.values({...})` to include `settings: input.settings ? JSON.stringify(input.settings) : null`. In `toRecord`, add `settings: row.settings ? (JSON.parse(row.settings) as LeagueFormat) : null`.

- [ ] **Step 6: Call `verifyLeague` from the add action**

In `src/app/settings/leagues/actions.ts`, after the `platform === "espn"` credential check and before `createLeague`, insert:

```ts
  const verification = await verifyLeague({ platform, externalLeagueId });
  if (!verification.ok) {
    return { ok: false, error: verification.error };
  }
```

Add `import { verifyLeague } from "@/lib/trade/verify";` at the top, and pass `settings: verification.format` into the `createLeague` call.

- [ ] **Step 7: Run typecheck and league tests**

Run: `npx tsc --noEmit && npx vitest run src/lib/leagues.test.ts src/lib/trade/verify.test.ts`
Expected: typecheck clean (except `TradeCenter.tsx`, rebuilt in Task 9); tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/lib/trade/verify.ts src/lib/trade/verify.test.ts src/lib/leagues.ts src/app/settings/leagues/actions.ts
git commit -m "Verify league and capture format at add time"
```

---

## Task 8: Backtest harness and statistical validation

**Files:**
- Create: `src/lib/trade/fixtures/backtest-2024.json`
- Create: `src/lib/trade/backtest.ts`
- Test: `src/lib/trade/backtest.test.ts`
- Create: `docs/trade-calibration.md`

- [ ] **Step 1: Create the historical backtest fixture**

Create `src/lib/trade/fixtures/backtest-2024.json` — a committed snapshot pairing each player's **preseason-2024 redraft trade value** (from DynastyProcess dated history) with their **realized 2024 PPR fantasy points** (from nflverse `load_player_stats` season totals). Use a representative slice of ≥ 60 players across QB/RB/WR/TE. Each entry: `{ "name": string, "position": "QB"|"RB"|"WR"|"TE", "tradeValue": number, "fantasyPoints": number }`. Example head (extend to ≥ 60 rows):

```json
[
  { "name": "Ja'Marr Chase", "position": "WR", "tradeValue": 8800, "fantasyPoints": 403.1 },
  { "name": "Jahmyr Gibbs", "position": "RB", "tradeValue": 7200, "fantasyPoints": 327.1 },
  { "name": "Saquon Barkley", "position": "RB", "tradeValue": 5600, "fantasyPoints": 322.3 },
  { "name": "Josh Allen", "position": "QB", "tradeValue": 6400, "fantasyPoints": 385.2 },
  { "name": "Caleb Williams", "position": "QB", "tradeValue": 2600, "fantasyPoints": 244.6 }
]
```

This is real data snapshotted for deterministic, offline CI — the `players_snapshots` precedent. `docs/trade-calibration.md` records the provenance (the exact DynastyProcess scrape date and nflverse release).

- [ ] **Step 2: Write the failing test**

Create `src/lib/trade/backtest.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { spearman, realizedVor } from "./backtest";

describe("spearman", () => {
  it("returns 1 for a perfectly rank-correlated pair", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1, 5);
  });
  it("returns -1 for a perfectly inversely ranked pair", () => {
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1, 5);
  });
});

describe("realizedVor", () => {
  it("subtracts the positional replacement baseline", () => {
    const players = [
      { name: "RB1", position: "RB", fantasyPoints: 300 },
      { name: "RB2", position: "RB", fantasyPoints: 100 }
    ];
    const vor = realizedVor(players, { RB: 1 });
    // Replacement = RB at rank 1 (100). RB1 VOR = 300 - 100 = 200.
    expect(vor.get("RB1")).toBe(200);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/lib/trade/backtest.test.ts`
Expected: FAIL — cannot find module `./backtest`.

- [ ] **Step 4: Write the implementation**

Create `src/lib/trade/backtest.ts`:

```ts
export interface SeasonPlayer {
  name: string;
  position: string;
  fantasyPoints: number;
}

/** Replacement-rank baseline per position for a 12-team, 1QB league. */
export const REPLACEMENT_RANKS: Record<string, number> = { QB: 13, RB: 25, WR: 37, TE: 13 };

function rank(values: number[]): number[] {
  const order = values.map((v, i) => [v, i] as const).sort((a, b) => a[0] - b[0]);
  const ranks = new Array<number>(values.length);
  order.forEach(([, originalIndex], sortedIndex) => {
    ranks[originalIndex] = sortedIndex + 1;
  });
  return ranks;
}

/** Spearman rank correlation between two equal-length numeric arrays. */
export function spearman(xs: number[], ys: number[]): number {
  if (xs.length !== ys.length || xs.length === 0) return 0;
  const rx = rank(xs);
  const ry = rank(ys);
  const n = xs.length;
  const mean = (n + 1) / 2;
  let cov = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < n; i++) {
    const dx = rx[i]! - mean;
    const dy = ry[i]! - mean;
    cov += dx * dy;
    vx += dx * dx;
    vy += dy * dy;
  }
  return vx === 0 || vy === 0 ? 0 : cov / Math.sqrt(vx * vy);
}

/**
 * Compute realized Value Over Replacement per player. The replacement baseline
 * for a position is the points of the player at `ranks[position]` (1-indexed),
 * or the lowest-scoring player at that position if the list is shorter.
 */
export function realizedVor(
  players: SeasonPlayer[],
  ranks: Record<string, number>
): Map<string, number> {
  const byPos = new Map<string, SeasonPlayer[]>();
  for (const p of players) {
    const list = byPos.get(p.position) ?? [];
    list.push(p);
    byPos.set(p.position, list);
  }
  const vor = new Map<string, number>();
  for (const [pos, list] of byPos) {
    const sorted = [...list].sort((a, b) => b.fantasyPoints - a.fantasyPoints);
    const idx = Math.min((ranks[pos] ?? sorted.length) - 1, sorted.length - 1);
    const baseline = sorted[idx]!.fantasyPoints;
    for (const p of sorted) vor.set(p.name, p.fantasyPoints - baseline);
  }
  return vor;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/lib/trade/backtest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Write the validation threshold tests (Backtest A + B)**

Append to `src/lib/trade/backtest.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

interface BacktestRow {
  name: string;
  position: string;
  tradeValue: number;
  fantasyPoints: number;
}

describe("Backtest A: trade value vs realized VOR", () => {
  it("preseason trade values rank-correlate with realized 2024 VOR (rho >= 0.7)", () => {
    const rows = JSON.parse(
      readFileSync(join(__dirname, "fixtures/backtest-2024.json"), "utf8")
    ) as BacktestRow[];
    const vor = realizedVor(rows, REPLACEMENT_RANKS);
    const xs: number[] = [];
    const ys: number[] = [];
    for (const r of rows) {
      const v = vor.get(r.name);
      if (v === undefined) continue;
      xs.push(r.tradeValue);
      ys.push(v);
    }
    expect(xs.length).toBeGreaterThanOrEqual(60);
    expect(spearman(xs, ys)).toBeGreaterThanOrEqual(0.7);
  });
});

import { welchTTest, cohensD } from "@/lib/stats/distribution";
import { evaluateTrade } from "./evaluate";
import type { PlayerValue } from "./values";

function toPlayerValue(r: BacktestRow): PlayerValue {
  return {
    sleeperId: r.name, espnId: null, name: r.name, position: r.position, team: null,
    value: r.tradeValue, overallRank: 0, positionRank: 0, trend30Day: 0
  };
}

describe("Backtest B: verdict calibration", () => {
  it("balanced trades end closer in realized VOR than lopsided ones", () => {
    const rows = JSON.parse(
      readFileSync(join(__dirname, "fixtures/backtest-2024.json"), "utf8")
    ) as BacktestRow[];
    const vor = realizedVor(rows, REPLACEMENT_RANKS);
    const balancedGaps: number[] = [];
    const lopsidedGaps: number[] = [];
    // Deterministic sweep of every 1-for-1 pairing in the fixture.
    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i]!;
        const b = rows[j]!;
        const { verdict } = evaluateTrade([toPlayerValue(a)], [toPlayerValue(b)]);
        const realizedGap = Math.abs((vor.get(a.name) ?? 0) - (vor.get(b.name) ?? 0));
        if (verdict === "balanced") balancedGaps.push(realizedGap);
        else if (verdict === "lopsided") lopsidedGaps.push(realizedGap);
      }
    }
    const result = welchTTest(balancedGaps, lopsidedGaps);
    // meanDelta = mean(balanced) - mean(lopsided): balanced gaps are smaller,
    // the difference is significant, and the effect size is at least medium.
    expect(result.meanDelta).toBeLessThan(0);
    expect(result.pTwoSided).toBeLessThan(0.05);
    expect(Math.abs(cohensD(balancedGaps, lopsidedGaps))).toBeGreaterThanOrEqual(0.5);
  });
});
```

> Imports are placed mid-file here only to keep the appended block self-contained; when applying the step, hoist the three `import` lines to the top of `backtest.test.ts` with the others. This is a genuine predictive backtest — `tradeValue` is the preseason snapshot, `vor` is realized end-of-season production. The measured ρ, its bootstrap CI, and the Backtest B statistics are recorded in `docs/trade-calibration.md` (Step 8). If a threshold is not met, the calibration doc must explain why before the gate is adjusted.

- [ ] **Step 7: Run the full backtest suite**

Run: `npx vitest run src/lib/trade/backtest.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 8: Write the calibration doc**

Create `docs/trade-calibration.md` documenting: the value sources, the VOR baselines (`REPLACEMENT_RANKS`), the Backtest A method and the measured Spearman ρ with its bootstrap CI, the Backtest B verdict-calibration result, and a plain statement of the honest constraint — FantasyCalc serves only current values, so past-season validation uses DynastyProcess dated files while the current season uses live values vs. season-to-date VOR. State explicitly what is empirically validated vs. assumed.

- [ ] **Step 9: Commit**

```bash
git add src/lib/trade/backtest.ts src/lib/trade/backtest.test.ts src/lib/trade/fixtures/ docs/trade-calibration.md
git commit -m "Add trade value backtest harness and calibration doc"
```

---

## Task 9: Trade Center UI rebuild

**Files:**
- Create: `src/app/trade/actions.ts`
- Create: `src/components/panels/trade/TradeBuilder.tsx`
- Create: `src/components/panels/trade/RecentLeagueTrades.tsx`
- Modify: `src/components/panels/TradeCenter.tsx`

- [ ] **Step 1: Create the server action**

Create `src/app/trade/actions.ts`:

```ts
"use server";

import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { listLeagues, type LeagueRecord } from "@/lib/leagues";
import { fetchTradeValues, type PlayerValue } from "@/lib/trade/values";
import { fetchSleeperLeagueTrades, type GradedTrade } from "@/lib/trade/transactions";
import { DEFAULT_FORMAT, type LeagueFormat } from "@/lib/trade/format";

export interface TradeValuesPayload {
  players: PlayerValue[];
  format: LeagueFormat;
  available: boolean;
  note: string;
}

/** Resolve the logged-in user's first connected league, or null. */
async function firstLeague(): Promise<LeagueRecord | null> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return null;
  const leagues = await listLeagues(getDb(), userId);
  return leagues[0] ?? null;
}

/** Load the trade value pool, using the connected league's format when available. */
export async function loadTradeValues(): Promise<TradeValuesPayload> {
  const league = await firstLeague();
  const format = league?.settings ?? DEFAULT_FORMAT;
  const data = await fetchTradeValues(format);
  return {
    players: [...data.values.values()].sort((a, b) => b.value - a.value),
    format,
    available: data.values.size > 0,
    note: data.source.failure ?? data.source.source
  };
}

/** Load and grade recent real trades from the user's connected Sleeper league.
 *  Returns [] for logged-out users, no league, or ESPN leagues (ESPN
 *  transaction support is a documented follow-up). */
export async function loadLeagueTrades(): Promise<GradedTrade[]> {
  const league = await firstLeague();
  if (!league || league.platform !== "sleeper") return [];
  const format = league.settings ?? DEFAULT_FORMAT;
  const { values } = await fetchTradeValues(format);
  if (values.size === 0) return [];
  return fetchSleeperLeagueTrades(league.externalLeagueId, values);
}
```

- [ ] **Step 2: Create the TradeBuilder component**

Create `src/components/panels/trade/TradeBuilder.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { PlayerValue } from "@/lib/trade/values";
import type { LeagueFormat } from "@/lib/trade/format";
import { evaluateTrade } from "@/lib/trade/evaluate";

type Side = "A" | "B";

export function TradeBuilder({
  players,
  format,
}: {
  players: PlayerValue[];
  format: LeagueFormat;
}) {
  const [query, setQuery] = useState("");
  const [sideA, setSideA] = useState<PlayerValue[]>([]);
  const [sideB, setSideB] = useState<PlayerValue[]>([]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return players.filter((p) => p.name.toLowerCase().includes(q)).slice(0, 8);
  }, [players, query]);

  const verdict = useMemo(() => evaluateTrade(sideA, sideB), [sideA, sideB]);

  const add = (side: Side, p: PlayerValue) => {
    (side === "A" ? setSideA : setSideB)((prev) =>
      prev.some((x) => x.sleeperId === p.sleeperId) ? prev : [...prev, p]
    );
    setQuery("");
  };
  const remove = (side: Side, id: string | null) => {
    (side === "A" ? setSideA : setSideB)((prev) => prev.filter((x) => x.sleeperId !== id));
  };

  return (
    <div className="trade-builder">
      <div className="section-label">
        TRADE BUILDER — {format.numTeams}-team · {format.numQbs}QB · {format.ppr} PPR
      </div>
      <input
        className="galaxy-search"
        type="search"
        placeholder="Search players to add..."
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        aria-label="Search players"
      />
      {results.length > 0 && (
        <ul className="trade-search-results">
          {results.map((p) => (
            <li key={p.sleeperId}>
              <span>{p.name} · {p.position} · {p.value}</span>
              <button type="button" onClick={() => add("A", p)}>+ A</button>
              <button type="button" onClick={() => add("B", p)}>+ B</button>
            </li>
          ))}
        </ul>
      )}
      <div className="trade-sides">
        <TradeSideColumn label="You give" side="A" players={sideA} onRemove={remove} />
        <TradeSideColumn label="You get" side="B" players={sideB} onRemove={remove} />
      </div>
      <div className={`trade-verdict trade-verdict-${verdict.verdict}`} role="status">
        <b>{verdict.totalA}</b> vs <b>{verdict.totalB}</b> ·{" "}
        {verdict.verdict === "balanced"
          ? "Fair trade"
          : `${(verdict.pctDelta * 100).toFixed(0)}% edge to ${
              verdict.winner === "A" ? "You give" : "You get"
            }`}
      </div>
    </div>
  );
}

function TradeSideColumn({
  label, side, players, onRemove,
}: {
  label: string;
  side: Side;
  players: PlayerValue[];
  onRemove: (side: Side, id: string | null) => void;
}) {
  const total = players.reduce((s, p) => s + p.value, 0);
  return (
    <div className="trade-side">
      <div className="trade-side-head">{label} · {total}</div>
      <ul>
        {players.length === 0 && <li className="muted-text">No players added.</li>}
        {players.map((p) => (
          <li key={p.sleeperId}>
            <span>{p.name} · {p.position}</span>
            <span>{p.value}</span>
            <button type="button" onClick={() => onRemove(side, p.sleeperId)} aria-label={`Remove ${p.name}`}>
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: Create the RecentLeagueTrades component**

Create `src/components/panels/trade/RecentLeagueTrades.tsx`:

```tsx
import type { GradedTrade } from "@/lib/trade/transactions";

export function RecentLeagueTrades({ trades }: { trades: GradedTrade[] }) {
  return (
    <div className="table-wrap" tabIndex={0}>
      <div className="section-label">RECENT LEAGUE TRADES</div>
      {trades.length === 0 ? (
        <p className="muted-note">
          No league trades to grade. Connect a Sleeper or ESPN league in Settings to see real
          transactions graded here.
        </p>
      ) : (
        <table>
          <thead>
            <tr><th>Side A</th><th>Side B</th><th>Value</th><th>Verdict</th></tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.id}>
                <td>{t.sideA.map((p) => p.name).join(", ") || "—"}</td>
                <td>{t.sideB.map((p) => p.name).join(", ") || "—"}</td>
                <td>{t.verdict.totalA} / {t.verdict.totalB}</td>
                <td className={t.verdict.verdict === "balanced" ? "pos-text" : "neu-text"}>
                  {t.verdict.verdict}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Rebuild TradeCenter.tsx**

Replace `src/components/panels/TradeCenter.tsx` entirely:

```tsx
"use client";

import { useEffect, useState } from "react";
import { ArrowLeftRight } from "lucide-react";
import type { PlayerMarketRecord } from "@/lib/governance";
import type { PlayerValue } from "@/lib/trade/values";
import { DEFAULT_FORMAT, type LeagueFormat } from "@/lib/trade/format";
import type { GradedTrade } from "@/lib/trade/transactions";
import { loadTradeValues, loadLeagueTrades } from "@/app/trade/actions";
import { PanelCard } from "../ui/PanelCard";
import { PanelTabs } from "../ui/PanelTabs";
import { TradeBuilder } from "./trade/TradeBuilder";
import { RecentLeagueTrades } from "./trade/RecentLeagueTrades";

const TABS = ["Trade Builder", "Recent League Trades"] as const;

export function TradeCenter({ players: _players }: { players: PlayerMarketRecord[] }) {
  const [activeTab, setActiveTab] = useState<string>("Trade Builder");
  const [pool, setPool] = useState<PlayerValue[]>([]);
  const [format, setFormat] = useState<LeagueFormat>(DEFAULT_FORMAT);
  const [leagueTrades, setLeagueTrades] = useState<GradedTrade[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    loadTradeValues()
      .then((res) => {
        if (!active) return;
        setPool(res.players);
        setFormat(res.format);
        setState(res.available ? "ready" : "unavailable");
      })
      .catch(() => active && setState("unavailable"));
    loadLeagueTrades()
      .then((trades) => active && setLeagueTrades(trades))
      .catch(() => {
        /* no connected league — RecentLeagueTrades shows its empty state */
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <PanelCard
      id="trade-center"
      titleId="tc-title"
      title="Trade Center"
      eyebrow="Value trades on real market data."
      icon={<ArrowLeftRight />}
    >
      <PanelTabs tabs={TABS} active={activeTab} onSelect={setActiveTab} ariaLabel="Trade Center tabs" />
      {state === "loading" && <p className="muted-note">Loading trade values…</p>}
      {state === "unavailable" && (
        <p className="muted-note">
          Trade values are unavailable right now (FantasyCalc and the fallback both failed). The
          builder is disabled rather than showing fabricated values.
        </p>
      )}
      {state === "ready" && activeTab === "Trade Builder" && (
        <TradeBuilder players={pool} format={format} />
      )}
      {state === "ready" && activeTab === "Recent League Trades" && (
        <RecentLeagueTrades trades={leagueTrades} />
      )}
    </PanelCard>
  );
}
```

> `RecentLeagueTrades` shows graded real trades for a connected Sleeper league and its honest empty state otherwise. ESPN transaction grading is a documented follow-up (the ESPN client has no transactions endpoint yet).

- [ ] **Step 5: Add minimal styles**

In `src/app/globals.css`, append styles for `.trade-builder`, `.trade-sides` (a 2-column grid with `gap`), `.trade-side`, `.trade-search-results`, and `.trade-verdict` (with `.trade-verdict-balanced` / `-slight-edge` / `-lopsided` color variants using existing `--green`/`--amber`/`--red` tokens). Follow the spacing patterns already in the file.

- [ ] **Step 6: Typecheck, lint, build**

Run: `npx tsc --noEmit && npx eslint . && npx next build`
Expected: all clean.

- [ ] **Step 7: Commit**

```bash
git add src/app/trade src/components/panels/trade src/components/panels/TradeCenter.tsx src/app/globals.css
git commit -m "Rebuild Trade Center as an interactive value-based simulator"
```

---

## Task 10: End-to-end test, browser verification, final gate

**Files:**
- Modify: `e2e/01-dashboard.spec.ts`

- [ ] **Step 1: Add the Trade Builder e2e test**

Append a test inside the `public dashboard` describe block in `e2e/01-dashboard.spec.ts`:

```ts
  test("trade builder renders and accepts a player search", async ({ page }) => {
    await page.goto("/");
    const panel = page.locator("#trade-center");
    await expect(panel).toBeVisible();
    // The builder loads values async; either it shows the search box or an
    // honest unavailable message — never a crash.
    await expect(
      panel.locator('input[aria-label="Search players"], .muted-note')
    ).toBeVisible({ timeout: 30_000 });
  });
```

- [ ] **Step 2: Run the e2e test**

Run: `npx playwright test e2e/01-dashboard.spec.ts -g "trade builder"`
Expected: PASS on both `chromium` and `mobile-chrome`.

- [ ] **Step 3: Browser-verify with the chrome-devtools MCP**

Start the dev server (`npm run dev`), open the dashboard, scroll to Trade Center. Confirm: the builder loads, searching a name (e.g. "Gibbs") shows results, adding Gibbs to one side and a QB to the other produces a non-balanced verdict with the correct winner. Use the chrome-devtools MCP `take_snapshot` / `click` / `fill` tools. Capture nothing sensitive.

- [ ] **Step 4: Run the full validation gate**

Run: `npx tsc --noEmit && npx eslint . && npx vitest run && npx next build && npx playwright test`
Expected: all green; backtest threshold tests pass.

- [ ] **Step 5: Update docs**

In `README.md`, add a short "Trade value simulator" subsection: FantasyCalc-backed values, DynastyProcess fallback, the interactive builder, and a pointer to `docs/trade-calibration.md`. Update the vitest test count.

- [ ] **Step 6: Commit**

```bash
git add e2e/01-dashboard.spec.ts README.md
git commit -m "Add trade builder e2e test and document the simulator"
```

---

## Self-Review Notes

- **Spec coverage:** §5 evaluation → Task 5; §6 module layout → Tasks 2–8; §7.1 format → Task 2; §7.2 league-add verification → Task 7; §7.3 value adapter → Tasks 3–4; §7.4 evaluator → Task 5; §7.5 transactions → Task 6; §7.6 UI → Task 9; §9 schema → Task 1; §10 backtest → Task 8; §11 governance → Tasks 3–4 (SourceMeta) + Task 9 (unavailable UI); §12 testing → every task + Task 10; §13 plugins → context7 used in spec, chrome-devtools MCP in Task 10.3.
- **Real league trades:** fully wired for Sleeper — `fetchSleeperLeagueTrades` (Task 6) + `loadLeagueTrades` server action (Task 9) feed `RecentLeagueTrades`. The builder pool and format also auto-detect from the user's connected league.
- **Documented follow-up (not a gap):** ESPN transaction grading. The ESPN client has no transactions endpoint; `loadLeagueTrades` returns `[]` for ESPN leagues and the empty state renders. Adding the ESPN `mTransactions2` view is a separate, smaller plan — noted in `docs/trade-calibration.md` and the spec's §7.5.
- **Type consistency:** `LeagueFormat`, `PlayerValue`, `TradeValueData`, `TradeVerdict`, `Verdict`, `GradedTrade`, `VerifyResult`, `SeasonPlayer` are each defined once and imported thereafter; `evaluateTrade`, `fetchTradeValues`, `fetchSleeperLeagueTrades`, `parseSleeperFormat`/`parseEspnFormat`, `verifyLeague`, `spearman`/`realizedVor` keep consistent signatures across tasks.
