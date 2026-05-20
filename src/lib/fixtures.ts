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
  narrativePressure: number;
  volatility: number;
  opportunity: number;
  confidence: number;
  rosterSlot: string;
  sleeperId: string;
  espnFallbackId?: number;
}> = [
  { id: "puka-nacua",          name: "Puka Nacua",          position: "WR", team: "LAR", perceivedValue: 72, trueValue: 84,  ownershipLeverage:  18, fragility: 34, narrativePressure:  47, volatility: 41, opportunity: 79, confidence: 0.62, rosterSlot: "WR1", sleeperId: "9493" },
  { id: "bijan-robinson",      name: "Bijan Robinson",      position: "RB", team: "ATL", perceivedValue: 91, trueValue: 86,  ownershipLeverage:  -8, fragility: 38, narrativePressure:  20, volatility: 32, opportunity: 88, confidence: 0.58, rosterSlot: "RB1", sleeperId: "9509" },
  { id: "josh-allen",          name: "Josh Allen",          position: "QB", team: "BUF", perceivedValue: 93, trueValue: 89,  ownershipLeverage: -14, fragility: 28, narrativePressure:  12, volatility: 36, opportunity: 83, confidence: 0.61, rosterSlot: "QB1", sleeperId: "4984",  espnFallbackId: 3918298 },
  { id: "jahmyr-gibbs",        name: "Jahmyr Gibbs",        position: "RB", team: "DET", perceivedValue: 83, trueValue: 90,  ownershipLeverage:  11, fragility: 31, narrativePressure:  29, volatility: 46, opportunity: 86, confidence: 0.57, rosterSlot: "RB2", sleeperId: "9221" },
  { id: "sam-laporta",         name: "Sam LaPorta",         position: "TE", team: "DET", perceivedValue: 68, trueValue: 77,  ownershipLeverage:  16, fragility: 24, narrativePressure:  18, volatility: 29, opportunity: 74, confidence: 0.55, rosterSlot: "TE1", sleeperId: "10859" },
  { id: "caleb-williams",      name: "Caleb Williams",      position: "QB", team: "CHI", perceivedValue: 61, trueValue: 68,  ownershipLeverage:  22, fragility: 49, narrativePressure:  64, volatility: 57, opportunity: 71, confidence: 0.48, rosterSlot: "QB2", sleeperId: "11560" },
  { id: "christian-mccaffrey", name: "Christian McCaffrey", position: "RB", team: "SF",  perceivedValue: 96, trueValue: 85,  ownershipLeverage: -21, fragility: 72, narrativePressure:  33, volatility: 62, opportunity: 81, confidence: 0.51, rosterSlot: "RB3", sleeperId: "4034",  espnFallbackId: 3117251 },
  { id: "marvin-harrison",     name: "Marvin Harrison Jr.", position: "WR", team: "ARI", perceivedValue: 78, trueValue: 82,  ownershipLeverage:   9, fragility: 36, narrativePressure:  52, volatility: 44, opportunity: 84, confidence: 0.50, rosterSlot: "WR2", sleeperId: "11628" }
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
    narrativePressure: row.narrativePressure,
    volatility: row.volatility,
    opportunity: row.opportunity,
    confidence: row.confidence,
    rosterSlot: row.rosterSlot,
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
