import { z } from "zod";
import type { SourceMeta } from "../governance";
import { evaluateFreshness, unavailableSource } from "../governance";
import { pprApproximated } from "./format";
import type { LeagueFormat } from "./format";
import { getLatestKtcSnapshot } from "../ktc/snapshot";
import type { KtcVariant } from "../ktc/types";
import type { LeagueType } from "./format";

/**
 * Which KTC value scale a league should use (audit 2026-08-06 F-010).
 *
 * This was a module CONSTANT pinned to "redraft" — the old comment even said
 * "for dynasty we want dynasty, mapping is trivial" and then never did it. The
 * cost was real: the ktc-refresh cron scrapes, stores and prunes the DYNASTY
 * snapshot every single day, and nothing ever read it (getLatestKtcSnapshot
 * ("dynasty") had zero call sites). Dynasty leagues were priced with redraft
 * values while their correct data sat unused in the database.
 *
 * Keeper leagues intentionally use redraft values: only a small number of
 * players carry over, so the marginal player is valued for THIS season.
 */
export function ktcVariantForLeague(format: LeagueFormat): KtcVariant {
  return valuationBasisFor(format);
}

/**
 * Which valuation horizon a league is priced on.
 *
 * Derived in exactly ONE place so the URL we request, the column we read and
 * the label we display can never disagree. Keeper is deliberately `redraft`:
 * only a small number of players carry over, so the marginal player is worth
 * what he is worth THIS season. That is a modelling choice, not an oversight,
 * and it is surfaced in the assumptions rather than left implicit.
 */
export type ValuationBasis = "dynasty" | "redraft";

export function valuationBasisFor(format: LeagueFormat): ValuationBasis {
  return format.leagueType === "dynasty" ? "dynasty" : "redraft";
}

export type ValuationProvider = "FantasyCalc" | "KeepTradeCut" | "DynastyProcess";

export interface ValuationProvenance {
  provider: ValuationProvider;
  /** The horizon the league SHOULD be priced on. */
  basis: ValuationBasis;
  /** The horizon the data actually carries — differs only on a degraded fallback. */
  actualBasis: ValuationBasis;
  leagueType: LeagueType;
  tier: "primary" | "secondary" | "tertiary";
}

/**
 * Human-readable provenance (audit P1 §4).
 *
 * The source label was hardcoded to "FantasyCalc redraft values" and
 * "KeepTradeCut redraft values (secondary)" regardless of what was actually
 * fetched, so a dynasty league priced on dynasty data still reported "redraft"
 * to the user. Decision-facing provenance has to describe the number that was
 * actually produced.
 *
 * When `actualBasis` disagrees with `basis` the label says so loudly, because
 * silently serving dynasty values to a redraft league — or the reverse — is
 * precisely the failure this string exists to make visible.
 */
export function describeValuationSource(p: ValuationProvenance): string {
  const tier = p.tier === "primary" ? "" : ` (${p.tier} fallback)`;
  if (p.actualBasis !== p.basis) {
    return `${p.provider} ${p.actualBasis} values — ${p.basis} unavailable${tier}`;
  }
  return `${p.provider} ${p.actualBasis} values${tier}`;
}

/**
 * The league-shape assumptions behind a valuation, spelled out for the
 * governance badge. Every one of these changes the numbers, so hiding them
 * would make the value look more universal than it is.
 */
export function valuationAssumptions(
  format: LeagueFormat,
  p: ValuationProvenance
): string[] {
  const out = [
    `Priced for a ${format.numTeams}-team, ${format.numQbs === 2 ? "superflex/2QB" : "1QB"}, ` +
      `${format.scoringFormat} (${format.pprActual ?? format.ppr} pt/reception) league.`,
    `Valuation horizon: ${p.actualBasis} (league type: ${p.leagueType}).`
  ];
  // The value APIs accept only 0 / 0.5 / 1 PPR. When the league's real setting
  // is something else the price IS an approximation, and saying so is cheaper
  // than the alternative — which for a 1.5 PPR league used to be pricing it as
  // STANDARD and reporting that as the league's format. Audit 2026-08-22, P1-3.
  if (pprApproximated(format.pprActual)) {
    out.push(
      `This league pays ${format.pprActual} per reception; the value source only supports ` +
        `0, 0.5 and 1, so these prices are fetched at ${format.ppr} PPR. Receiving-heavy players ` +
        `are priced conservatively as a result.`
    );
  }
  if (p.leagueType === "keeper") {
    out.push(
      "Keeper leagues are priced on redraft values: only a few players carry over, so the " +
        "marginal player is valued for this season."
    );
  }
  if (p.actualBasis !== p.basis) {
    out.push(
      `DEGRADED: this league should be priced on ${p.basis} values, but only ${p.actualBasis} ` +
        `data was available from ${p.provider}. Treat rankings as directional.`
    );
  }
  return out;
}

// KTC snapshots are written by a daily cron (09:00 UTC); within 30h
// (24h cadence + buffer) the snapshot is the expected state, not stale.
const KTC_SNAPSHOT_TTL_SECONDS = 30 * 3600;

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
  // Both value columns are nullish so ONE malformed entry is skipped rather
  // than throwing away the whole board. A genuine outage still reaches the KTC
  // fallback via the HTTP check, and an all-null payload yields an empty map,
  // which `available: values.size > 0` already reports as unavailable.
  value: z.number().nullish(),
  redraftValue: z.number().nullish(),
  overallRank: z.number(),
  positionRank: z.number(),
  trend30Day: z.number().nullish()
});
const FantasyCalcResponseSchema = z.array(FantasyCalcEntrySchema);

const FANTASYCALC_TTL_SECONDS = 43_200; // 12h

export function buildFantasyCalcUrl(format: LeagueFormat): string {
  // isDynasty was a hardcoded literal `false` (F-010), so a dynasty league was
  // handed redraft values by the API itself, not just by our variant choice.
  const isDynasty = valuationBasisFor(format) === "dynasty";
  return (
    "https://api.fantasycalc.com/values/current" +
    `?isDynasty=${isDynasty}&numQbs=${format.numQbs}&numTeams=${format.numTeams}&ppr=${format.ppr}`
  );
}

/**
 * Map a validated FantasyCalc payload into a sleeperId-keyed PlayerValue map.
 *
 * `basis` is REQUIRED — no default. A silent `= "redraft"` default is what let
 * the production caller omit the argument entirely while the surrounding code
 * carefully computed a dynasty URL, so every dynasty league was parsed through
 * the redraft branch. For a decision-critical parser, an omitted argument must
 * be a type error rather than a quiet business-semantics choice.
 *
 * WHICH COLUMN, and why this is not the obvious one:
 *
 * `value` is the answer to the query we actually sent — FantasyCalc scales it by
 * the `isDynasty`, `numTeams`, `numQbs` and `ppr` parameters in the URL.
 * `redraftValue` is a FORMAT-INDEPENDENT canonical figure, verified live on
 * 2026-08-16: Jahmyr Gibbs returns redraftValue 10017 at numTeams 8, 12 and 14
 * and at ppr 0, 0.5 and 1 — identical every time — while `value` moves to
 * 10041 / 10017 / 10009 and 10074 / 10011 / 10017 respectively.
 *
 * So the previous `redraftValue ?? value` ordering threw away every format
 * adjustment the URL had just asked for: three of the operator's four ESPN
 * leagues are not 12-team full-PPR, and all of them were being priced as if
 * they were. The scoring effect is decision-relevant, not cosmetic — at ppr 0
 * Gibbs (RB) leads Ja'Marr Chase (WR) 10074 to 9527, a 547-point gap that
 * narrows to 320 at full PPR.
 *
 * `value` is therefore correct for BOTH bases, because the basis was already
 * selected by `isDynasty` in the URL. `redraftValue` survives only as a
 * null-guard for entries where FantasyCalc omits `value`.
 */
export function parseFantasyCalc(
  raw: unknown,
  basis: ValuationBasis
): Map<string, PlayerValue> {
  const entries = FantasyCalcResponseSchema.parse(raw);
  const map = new Map<string, PlayerValue>();
  for (const e of entries) {
    const sleeperId = e.player.sleeperId != null ? String(e.player.sleeperId) : null;
    if (!sleeperId) continue;
    // For a dynasty request `value` is the dynasty figure; for a redraft
    // request it is the format-scaled redraft figure. Either way it is the
    // response to the basis we asked for.
    //
    // When it is missing, `basis` decides whether a fallback is even honest.
    // `redraftValue` is a redraft number: acceptable for a redraft league
    // (right horizon, canonical format), but for a dynasty league it is the
    // WRONG horizon, and omitting the player is better than pricing a dynasty
    // asset off this season alone.
    const value = e.value ?? (basis === "redraft" ? e.redraftValue : null);
    if (value == null) continue;
    map.set(sleeperId, {
      sleeperId,
      espnId: e.player.espnId != null ? String(e.player.espnId) : null,
      name: e.player.name,
      position: e.player.position,
      team: e.player.maybeTeam ?? null,
      value,
      overallRank: e.overallRank,
      positionRank: e.positionRank,
      trend30Day: e.trend30Day ?? 0
    });
  }
  return map;
}

const DYNASTYPROCESS_CSV_URL =
  "https://raw.githubusercontent.com/dynastyprocess/data/master/files/values.csv";

/**
 * Parse the DynastyProcess values.csv text into a "<pos>-<name>"-keyed map.
 *
 * NOTE: Every entry is returned with `sleeperId: null` and `espnId: null`
 * because DynastyProcess rows carry no platform IDs. When FantasyCalc is down
 * and this fallback is active, the Trade Builder (search-based) still works
 * because it matches by name. However, `loadLeagueTrades` joins executed
 * transactions by `sleeperId`/`espnId`, so it will grade nothing — an honest
 * degradation rather than fabricated grades.
 */
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

// KTC -> PlayerValue map. Keyed by "<pos>-<name>" (lowercased, name-normalized
// only for separator/case) to match DynastyProcess's join shape. KTC has no
// sleeperId/espnId, so trade-grading by id falls through to DynastyProcess
// behavior — Trade Builder (search-based) still works.
export async function fetchKtcValues(
  format: LeagueFormat,
  variant: KtcVariant = ktcVariantForLeague(format)
): Promise<{ values: Map<string, PlayerValue>; fetchedAt: string }> {
  const snapshot = await getLatestKtcSnapshot(variant);
  if (!snapshot) throw new Error(`KTC ${variant} snapshot not cached`);
  const map = new Map<string, PlayerValue>();
  for (const p of snapshot.data.players) {
    // Pick the right value scale for the league's QB count. Superflex
    // leagues should consult oneQBValues even though the format is 2QB —
    // KTC's "superflexValues" overstates RB/WR values by the QB premium,
    // which would skew non-QB pricing in a Superflex builder. We err on
    // the side of position-neutral; a future commit can branch by format.
    const value = format.numQbs === 2 && p.superflexValues
      ? p.superflexValues.startSitValue
      : p.oneQBValues.startSitValue;
    if (!Number.isFinite(value)) continue;
    const key = `${p.position.toLowerCase()}-${p.playerName.toLowerCase()}`;
    map.set(key, {
      sleeperId: null,
      espnId: null,
      name: p.playerName,
      position: p.position,
      team: p.team ?? null,
      value,
      overallRank: p.oneQBValues.startSitOverallRank ?? 0,
      positionRank: p.oneQBValues.startSitPositionalRank ?? 0,
      trend30Day: p.oneQBValues.overall7DayTrend ?? 0
    });
  }
  // Surface the snapshot's REAL timestamp so the caller can derive freshness
  // from actual age instead of stamping "now" (DAT-03).
  return { values: map, fetchedAt: snapshot.fetchedAt.toISOString() };
}

/** Fetch live trade values, governance-wrapped. */
export async function fetchTradeValues(format: LeagueFormat): Promise<TradeValueData> {
  const basis = valuationBasisFor(format);
  const url = buildFantasyCalcUrl(format);
  try {
    const res = await fetch(url, { next: { revalidate: FANTASYCALC_TTL_SECONDS } });
    if (!res.ok) throw new Error(`FantasyCalc HTTP ${res.status}`);
    // The basis passed here is the SAME value that built the URL above, so the
    // column read can never disagree with the endpoint queried.
    const values = parseFantasyCalc(await res.json(), basis);
    const provenance: ValuationProvenance = {
      provider: "FantasyCalc",
      basis,
      actualBasis: basis,
      leagueType: format.leagueType,
      tier: "primary"
    };
    return {
      values,
      source: {
        source: describeValuationSource(provenance),
        fetchedAt: new Date().toISOString(),
        ttlSeconds: FANTASYCALC_TTL_SECONDS,
        freshness: "fresh",
        confidence: 0.9,
        validation: "valid",
        missingFields: [],
        assumptions: valuationAssumptions(format, provenance),
        failure: null
      }
    };
  } catch (primaryErr) {
    // Secondary: KeepTradeCut cached snapshot. Daily cron at 09:00 UTC.
    try {
      const variant = ktcVariantForLeague(format);
      const { values, fetchedAt } = await fetchKtcValues(format, variant);
      // KTC stores a dynasty AND a redraft snapshot, so the secondary can serve
      // the league's real horizon rather than degrading to redraft.
      const provenance: ValuationProvenance = {
        provider: "KeepTradeCut",
        basis,
        actualBasis: variant,
        leagueType: format.leagueType,
        tier: "secondary"
      };
      return {
        values,
        source: {
          source: describeValuationSource(provenance),
          // Real snapshot timestamp; freshness derived from actual age against
          // the daily cron cadence (30h = 24h cadence + buffer), not hardcoded.
          fetchedAt,
          ttlSeconds: KTC_SNAPSHOT_TTL_SECONDS,
          freshness: evaluateFreshness(fetchedAt, KTC_SNAPSHOT_TTL_SECONDS),
          confidence: 0.75,
          validation: "valid",
          missingFields: ["sleeperId"],
          assumptions: [
            ...valuationAssumptions(format, provenance),
            "FantasyCalc unavailable; using KeepTradeCut consensus values keyed by name.",
            `Primary failure: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`
          ],
          failure: null
        }
      };
    } catch (ktcErr) {
      // Tertiary: DynastyProcess CSV.
      try {
        const values = await fetchDynastyProcessValues(format);
        // DynastyProcess `values.csv` publishes DYNASTY trade values only — the
        // live header is player,pos,team,age,draft_year,ecr_1qb,ecr_2qb,ecr_pos,
        // value_1qb,value_2qb,scrape_date,fp_id, with no redraft column. For a
        // dynasty league that is the right horizon; for redraft or keeper it is
        // not, and the mismatch is declared rather than relabelled.
        const provenance: ValuationProvenance = {
          provider: "DynastyProcess",
          basis,
          actualBasis: "dynasty",
          leagueType: format.leagueType,
          tier: "tertiary"
        };
        return {
          values,
          source: {
            source: describeValuationSource(provenance),
            // Live HTTP fetch that just succeeded — "now" is the real timestamp
            // and "fresh" the honest label; confidence conveys lower trust.
            fetchedAt: new Date().toISOString(),
            ttlSeconds: FANTASYCALC_TTL_SECONDS,
            freshness: "fresh",
            // A horizon mismatch is a bigger quality hit than the fallback
            // itself, so it costs more confidence than a same-horizon tertiary.
            confidence: basis === "dynasty" ? 0.6 : 0.45,
            validation: "valid",
            missingFields: ["sleeperId"],
            assumptions: [
              ...valuationAssumptions(format, provenance),
              "FantasyCalc + KTC both unavailable; using DynastyProcess ECR-derived values keyed by name.",
              `Primary failure: ${primaryErr instanceof Error ? primaryErr.message : String(primaryErr)}`,
              `Secondary failure: ${ktcErr instanceof Error ? ktcErr.message : String(ktcErr)}`
            ],
            failure: null
          }
        };
      } catch (fallbackErr) {
        return {
          values: new Map(),
          source: unavailableSource(
            "Trade values",
            `All three value sources failed — FantasyCalc: ${
              primaryErr instanceof Error ? primaryErr.message : String(primaryErr)
            }; KTC: ${
              ktcErr instanceof Error ? ktcErr.message : String(ktcErr)
            }; DynastyProcess: ${
              fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
            }`
          )
        };
      }
    }
  }
}
