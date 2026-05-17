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
    "Fixture values must not be presented as live rankings, projections, ownership, or betting intelligence."
  ],
  failure: null
};

const ESPN_CDN = "https://a.espncdn.com/i/headshots/nfl/players/full";
const IMG_SRC = "ESPN headshot CDN";

export const fixturePlayers: PlayerMarketRecord[] = [
  // [id, name, pos, team, perceived, true, ownership, fragility, narrativePressure, volatility, opportunity, confidence, rosterSlot, espnId]
  ["puka-nacua",          "Puka Nacua",           "WR", "LAR", 72, 84,  18, 34, 47, 41, 79, 0.62, "WR1",  4362887],
  ["bijan-robinson",      "Bijan Robinson",       "RB", "ATL", 91, 86,  -8, 38, 20, 32, 88, 0.58, "RB1",  4428333],
  ["josh-allen",          "Josh Allen",           "QB", "BUF", 93, 89, -14, 28, 12, 36, 83, 0.61, "QB1",  3918298],
  ["jahmyr-gibbs",        "Jahmyr Gibbs",         "RB", "DET", 83, 90,  11, 31, 29, 46, 86, 0.57, "RB2",  4569618],
  ["sam-laporta",         "Sam LaPorta",          "TE", "DET", 68, 77,  16, 24, 18, 29, 74, 0.55, "TE1",  4567048],
  ["caleb-williams",      "Caleb Williams",       "QB", "CHI", 61, 68,  22, 49, 64, 57, 71, 0.48, "QB2",  4430737],
  ["christian-mccaffrey", "Christian McCaffrey",  "RB", "SF",  96, 85, -21, 72, 33, 62, 81, 0.51, "RB3",  3054211],
  ["marvin-harrison",     "Marvin Harrison Jr.",  "WR", "ARI", 78, 82,   9, 36, 52, 44, 84, 0.50, "WR2",  4685717],
].map(([id, name, position, team, perceivedValue, trueValue, ownershipLeverage, fragility, narrativePressure, volatility, opportunity, confidence, rosterSlot, espnId]) => ({
  id: String(id),
  name: String(name),
  position: position as PlayerMarketRecord["position"],
  team: String(team),
  perceivedValue: Number(perceivedValue),
  trueValue: Number(trueValue),
  ownershipLeverage: Number(ownershipLeverage),
  fragility: Number(fragility),
  narrativePressure: Number(narrativePressure),
  volatility: Number(volatility),
  opportunity: Number(opportunity),
  confidence: Number(confidence),
  rosterSlot: String(rosterSlot),
  status: "active" as const,
  imageUrl: `${ESPN_CDN}/${espnId}.png`,
  imageSource: IMG_SRC,
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
