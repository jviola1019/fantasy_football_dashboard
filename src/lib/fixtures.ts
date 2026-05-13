import type { PlayerMarketRecord, RAEEnvelope, SourceMeta } from "./governance";

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
    "Fixture values must not be presented as live rankings, projections, ownership, or betting intelligence.",
    "Player headshots are remote ESPN CDN references verified during development and are not committed binary assets."
  ],
  failure: null
};

type FixtureTuple = [
  string,
  string,
  PlayerMarketRecord["position"],
  string,
  number,
  string,
  PlayerMarketRecord["status"],
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  string
];

const headshot = (espnId: string) => `http://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;

export const fixturePlayers: PlayerMarketRecord[] = ([
  ["puka-nacua", "Puka Nacua", "WR", "LAR", 17, "WR1", "active", 72, 84, 18, 34, 47, 41, 79, 0.62, 4426515, "Rising Stars"],
  ["bijan-robinson", "Bijan Robinson", "RB", "ATL", 7, "RB1", "active", 91, 86, -8, 38, 20, 32, 88, 0.58, 4430807, "Elite Tier"],
  ["josh-allen", "Josh Allen", "QB", "BUF", 17, "QB", "active", 93, 89, -14, 28, 12, 36, 83, 0.61, 3918298, "Elite Tier"],
  ["jahmyr-gibbs", "Jahmyr Gibbs", "RB", "DET", 0, "FLEX", "active", 83, 90, 11, 31, 29, 46, 86, 0.57, 4429795, "Rising Stars"],
  ["sam-laporta", "Sam LaPorta", "TE", "DET", 87, "TE", "questionable", 68, 77, 16, 24, 18, 29, 74, 0.55, 4430027, "Sleepers"],
  ["caleb-williams", "Caleb Williams", "QB", "CHI", 18, "BENCH", "active", 61, 68, 22, 49, 64, 57, 71, 0.48, 4431611, "Volatile Assets"],
  ["christian-mccaffrey", "Christian McCaffrey", "RB", "SF", 23, "BENCH", "questionable", 96, 85, -21, 72, 33, 62, 81, 0.51, 3117251, "Fade Candidates"],
  ["marvin-harrison", "Marvin Harrison Jr.", "WR", "ARI", 18, "BENCH", "active", 78, 82, 9, 36, 52, 44, 84, 0.5, 4432708, "Sleepers"]
] satisfies FixtureTuple[]).map(([
  id,
  name,
  position,
  team,
  jerseyNumber,
  rosterSlot,
  status,
  perceivedValue,
  trueValue,
  ownershipLeverage,
  fragility,
  narrativePressure,
  volatility,
  opportunity,
  confidence,
  espnId,
  imageSource
]) => ({
  id,
  name,
  position,
  team,
  jerseyNumber,
  rosterSlot,
  status,
  imageUrl: headshot(String(espnId)),
  imageSource: `ESPN headshot CDN · ${imageSource}`,
  perceivedValue,
  trueValue,
  ownershipLeverage,
  fragility,
  narrativePressure,
  volatility,
  opportunity,
  confidence,
  sources: [fixtureSource]
}));

export function fixtureEnvelope(): RAEEnvelope {
  return {
    mode: "fixture",
    generatedAt: new Date("2026-05-13T00:00:00.000Z").toISOString(),
    records: fixturePlayers,
    sourceState: fixtureSource
  };
}
