import type { PlayerMarketRecord, RAEEnvelope, SourceMeta } from "./governance";
import { getHeadshotSources } from "./headshots";

const fixtureSource: SourceMeta = {
  source: "RAE dev/test fixture catalog",
  fetchedAt: new Date("2026-05-13T00:00:00.000Z").toISOString(),
  ttlSeconds: 31_536_000,
  freshness: "fixture",
  confidence: 0.42,
  validation: "valid",
  missingFields: [],
  assumptions: [
    "Fixture values are handcrafted for UI, schema, and simulation development only.",
    "Fixture values must not be presented as live rankings, projections, ownership, or betting intelligence."
  ],
  failure: null
};

const IMG_SRC = "Sleeper headshot CDN";

/**
 * Fixture players. The `sleeperId` field is each player's *canonical* Sleeper
 * player_id (verified against api.sleeper.app/v1/players/nfl on 2026-05-19).
 * The image URL is derived from the Sleeper CDN; if Sleeper ever 404s for a
 * given ID, `<PlayerHeadshot>` cascades to fallbacks and finally initials —
 * never to a different player's face.
 *
 * The original fixture had a wrong ESPN id for Puka Nacua (4362887 = Justin
 * Fields). That class of bug is now structurally impossible: every headshot
 * is keyed by a verified Sleeper id, and the Sleeper CDN is keyed by that id.
 */
const FIXTURE_ROWS: ReadonlyArray<{
  id: string;
  name: string;
  position: PlayerMarketRecord["position"];
  team: string;
  perceivedValue: number;
  trueValue: number;
  ownershipLeverage: number;
  fragility: number;
  trendingMomentum: number;
  volatility: number;
  opportunity: number;
  confidence: number;
  rosterSlot: string;
  /**
   * Handcrafted like every other fixture value, and internally CONSISTENT in
   * the two ways that matter, so the demo exercises real invariants rather than
   * showing eight unrelated numbers:
   *
   *   - Teammates share a bye. Gibbs and LaPorta are both Detroit, both week 6
   *     -- and both are DIFFERENT positions, so that pair is not a clash.
   *   - Two different teams can share a week, exactly as the real schedule
   *     works. Bijan Robinson (ATL) and Christian McCaffrey (SF) are both week
   *     5 and both RB, which IS a clash -- so the draft board's stacking
   *     warning is reachable in the demo instead of being dead code nobody
   *     ever sees fire.
   */
  byeWeek: number;
  /** Season-to-date rate stats, handcrafted like every other fixture value, so
   *  the demo exercises the validated in-season ranking instead of rendering
   *  "unavailable" and teaching nobody that the feature exists. */
  pointsPerGame: number;
  touchesPerGame: number;
  sleeperId: string;
  espnFallbackId?: number;
}> = [
  { id: "puka-nacua",          name: "Puka Nacua",          position: "WR", team: "LAR", perceivedValue: 72, trueValue: 84,  ownershipLeverage:  18, fragility: 34, trendingMomentum:  47, volatility: 41, opportunity: 79, confidence: 0.62, rosterSlot: "WR1", byeWeek: 8, pointsPerGame: 16.8, touchesPerGame: 9.4, sleeperId: "9493" },
  { id: "bijan-robinson",      name: "Bijan Robinson",      position: "RB", team: "ATL", perceivedValue: 91, trueValue: 86,  ownershipLeverage:  -8, fragility: 38, trendingMomentum:  20, volatility: 32, opportunity: 88, confidence: 0.58, rosterSlot: "RB1", byeWeek: 5, pointsPerGame: 17.9, touchesPerGame: 20.1, sleeperId: "9509" },
  { id: "josh-allen",          name: "Josh Allen",          position: "QB", team: "BUF", perceivedValue: 93, trueValue: 89,  ownershipLeverage: -14, fragility: 28, trendingMomentum:  12, volatility: 36, opportunity: 83, confidence: 0.61, rosterSlot: "QB1", byeWeek: 7, pointsPerGame: 22.4, touchesPerGame: 6.2, sleeperId: "4984",  espnFallbackId: 3918298 },
  { id: "jahmyr-gibbs",        name: "Jahmyr Gibbs",        position: "RB", team: "DET", perceivedValue: 83, trueValue: 90,  ownershipLeverage:  11, fragility: 31, trendingMomentum:  29, volatility: 46, opportunity: 86, confidence: 0.57, rosterSlot: "RB2", byeWeek: 6, pointsPerGame: 18.6, touchesPerGame: 18.3, sleeperId: "9221" },
  { id: "sam-laporta",         name: "Sam LaPorta",         position: "TE", team: "DET", perceivedValue: 68, trueValue: 77,  ownershipLeverage:  16, fragility: 24, trendingMomentum:  18, volatility: 29, opportunity: 74, confidence: 0.55, rosterSlot: "TE1", byeWeek: 6, pointsPerGame: 11.2, touchesPerGame: 6.8, sleeperId: "10859" },
  { id: "caleb-williams",      name: "Caleb Williams",      position: "QB", team: "CHI", perceivedValue: 61, trueValue: 68,  ownershipLeverage:  22, fragility: 49, trendingMomentum:  64, volatility: 57, opportunity: 71, confidence: 0.48, rosterSlot: "QB2", byeWeek: 9, pointsPerGame: 15.1, touchesPerGame: 4.9, sleeperId: "11560" },
  { id: "christian-mccaffrey", name: "Christian McCaffrey", position: "RB", team: "SF",  perceivedValue: 96, trueValue: 85,  ownershipLeverage: -21, fragility: 72, trendingMomentum:  33, volatility: 62, opportunity: 81, confidence: 0.51, rosterSlot: "RB3", byeWeek: 5, pointsPerGame: 16.2, touchesPerGame: 19.4, sleeperId: "4034",  espnFallbackId: 3117251 },
  // Added 2026-08-23 so the VALIDATED in-season ranking is demonstrable. It
  // standardises within position and protocol 5 skipped cohorts below five, so
  // with three RBs and two WRs the board could only ever render its empty
  // state. The threshold was NOT lowered to make the demo look better -- five
  // is what was validated; the catalog grew instead.
  //
  // Every sleeperId below was verified against api.sleeper.app/v1/players/nfl
  // on 2026-08-23, the same rule the original eight follow: a wrong id shows a
  // different player's face.
  { id: "saquon-barkley",      name: "Saquon Barkley",      position: "RB", team: "PHI", perceivedValue: 94, trueValue: 92,  ownershipLeverage:  -6, fragility: 41, trendingMomentum:  24, volatility: 38, opportunity: 89, confidence: 0.59, rosterSlot: "RB4", byeWeek: 9,  pointsPerGame: 19.8, touchesPerGame: 21.6, sleeperId: "4866" },
  { id: "derrick-henry",       name: "Derrick Henry",       position: "RB", team: "BAL", perceivedValue: 88, trueValue: 83,  ownershipLeverage: -11, fragility: 52, trendingMomentum:  15, volatility: 43, opportunity: 82, confidence: 0.54, rosterSlot: "RB5", byeWeek: 14, pointsPerGame: 16.4, touchesPerGame: 17.9, sleeperId: "3198" },
  { id: "breece-hall",         name: "Breece Hall",         position: "RB", team: "NYJ", perceivedValue: 79, trueValue: 74,  ownershipLeverage:  -5, fragility: 44, trendingMomentum:   8, volatility: 47, opportunity: 76, confidence: 0.52, rosterSlot: "RB6", byeWeek: 12, pointsPerGame: 13.1, touchesPerGame: 15.2, sleeperId: "8155" },
  { id: "jamarr-chase",        name: "Ja'Marr Chase",       position: "WR", team: "CIN", perceivedValue: 95, trueValue: 93,  ownershipLeverage:  -4, fragility: 27, trendingMomentum:  31, volatility: 39, opportunity: 91, confidence: 0.63, rosterSlot: "WR3", byeWeek: 10, pointsPerGame: 20.6, touchesPerGame: 10.8, sleeperId: "7564" },
  { id: "ceedee-lamb",         name: "CeeDee Lamb",         position: "WR", team: "DAL", perceivedValue: 90, trueValue: 87,  ownershipLeverage:  -7, fragility: 30, trendingMomentum:  19, volatility: 40, opportunity: 88, confidence: 0.60, rosterSlot: "WR4", byeWeek: 10, pointsPerGame: 18.2, touchesPerGame: 10.1, sleeperId: "6786" },
  { id: "justin-jefferson",    name: "Justin Jefferson",    position: "WR", team: "MIN", perceivedValue: 92, trueValue: 91,  ownershipLeverage:  -3, fragility: 29, trendingMomentum:  22, volatility: 37, opportunity: 90, confidence: 0.62, rosterSlot: "WR5", byeWeek: 6,  pointsPerGame: 19.4, touchesPerGame: 9.6,  sleeperId: "6794" },
  { id: "marvin-harrison",     name: "Marvin Harrison Jr.", position: "WR", team: "ARI", perceivedValue: 78, trueValue: 82,  ownershipLeverage:   9, fragility: 36, trendingMomentum:  52, volatility: 44, opportunity: 84, confidence: 0.50, rosterSlot: "WR2", byeWeek: 11, pointsPerGame: 13.7, touchesPerGame: 8.1, sleeperId: "11628" }
];

export const fixturePlayers: PlayerMarketRecord[] = FIXTURE_ROWS.map((row) => {
  const sources = getHeadshotSources({ sleeperId: row.sleeperId, espnId: row.espnFallbackId ?? null });
  const primary = sources[0] ?? "https://sleepercdn.com/images/v2/icons/player_default.webp";
  return {
    id: row.id,
    name: row.name,
    position: row.position,
    team: row.team,
    perceivedValue: row.perceivedValue,
    trueValue: row.trueValue,
    ownershipLeverage: row.ownershipLeverage,
    fragility: row.fragility,
    trendingMomentum: row.trendingMomentum,
    volatility: row.volatility,
    opportunity: row.opportunity,
    confidence: row.confidence,
    rosterSlot: row.rosterSlot,
    byeWeek: row.byeWeek,
    pointsPerGame: row.pointsPerGame,
    touchesPerGame: row.touchesPerGame,
    status: "active" as const,
    imageUrl: primary,
    imageSource: IMG_SRC,
    sources: [fixtureSource]
  };
});

/** Per-player headshot fallback chain; consumed by `<PlayerHeadshot fallbacks=...>`. */
export const fixtureHeadshotFallbacks: Record<string, string[]> = Object.fromEntries(
  FIXTURE_ROWS.map((row) => {
    const sources = getHeadshotSources({ sleeperId: row.sleeperId, espnId: row.espnFallbackId ?? null });
    return [row.id, sources.slice(1)];
  })
);

export function fixtureEnvelope(): RAEEnvelope {
  return {
    mode: "fixture",
    generatedAt: new Date("2026-05-13T00:00:00.000Z").toISOString(),
    records: fixturePlayers,
    sourceState: fixtureSource
  };
}
