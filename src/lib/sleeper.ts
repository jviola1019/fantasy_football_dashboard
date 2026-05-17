import { z } from "zod";
import {
  RAEEnvelopeSchema,
  unavailableSource,
  type RAEEnvelope,
  type PlayerMarketRecord,
  type SourceMeta,
} from "./governance";
import { fixtureEnvelope } from "./fixtures";

const SleeperPlayerRawSchema = z
  .object({
    player_id: z.string().optional(),
    full_name: z.string().optional().nullable(),
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    position: z.string().optional().nullable(),
    team: z.string().optional().nullable(),
    active: z.boolean().optional().nullable(),
    status: z.string().optional().nullable(),
    injury_status: z.string().optional().nullable(),
    depth_chart_position: z.string().optional().nullable(),
    depth_chart_order: z.number().optional().nullable(),
    years_exp: z.number().optional().nullable(),
    age: z.number().optional().nullable(),
    search_rank: z.number().optional().nullable(),
    espn_id: z.string().optional().nullable(),
  })
  .passthrough();

const SleeperPlayersSchema = z.record(z.string(), SleeperPlayerRawSchema);

export const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

const SKILL_POSITIONS = new Set(["QB", "RB", "WR", "TE"]);

const POSITION_BASE: Record<string, { perceived: number; true: number }> = {
  QB: { perceived: 80, true: 80 },
  RB: { perceived: 70, true: 70 },
  WR: { perceived: 70, true: 70 },
  TE: { perceived: 60, true: 60 },
};

function deriveStatus(raw: z.infer<typeof SleeperPlayerRawSchema>): PlayerMarketRecord["status"] {
  if (!raw.active) return "unknown";
  const inj = raw.injury_status?.toLowerCase() ?? null;
  if (inj === null) return "active";
  if (inj === "questionable" || inj === "doubtful") return "questionable";
  if (inj === "out") return "out";
  if (inj === "ir" || inj === "pup") return "ir";
  if (inj === "bye") return "bye";
  return "active";
}

function derivePlaceholderImageUrl(playerId: string): string {
  return `https://sleepercdn.com/content/nfl/players/thumb/${playerId}.jpg`;
}

function toPlayerMarketRecord(
  id: string,
  raw: z.infer<typeof SleeperPlayerRawSchema>,
  fetchedAt: string
): PlayerMarketRecord | null {
  const pos = raw.position as PlayerMarketRecord["position"] | undefined;
  if (!pos || !SKILL_POSITIONS.has(pos)) return null;

  const name =
    raw.full_name ??
    [raw.first_name, raw.last_name].filter(Boolean).join(" ").trim();
  if (!name) return null;

  const depthOrder = raw.depth_chart_order ?? 3;
  const yearsExp = raw.years_exp ?? 2;
  const age = raw.age ?? 25;

  const posBase = POSITION_BASE[pos] ?? { perceived: 60, true: 60 };
  const depthAdj = depthOrder === 1 ? 18 : depthOrder === 2 ? 2 : -16;
  const expAdj = yearsExp < 3 ? 3 : yearsExp > 8 ? -3 : 0;

  const perceivedValue = Math.min(100, Math.max(0, Math.round(posBase.perceived + depthAdj)));
  const trueValue = Math.min(100, Math.max(0, Math.round(posBase.true + depthAdj + expAdj)));

  const injStatus = raw.injury_status?.toLowerCase() ?? null;
  const fragility =
    injStatus === null ? 20
    : injStatus === "questionable" ? 44
    : injStatus === "doubtful" ? 62
    : injStatus === "out" ? 78
    : injStatus === "ir" || injStatus === "pup" ? 90
    : 30;

  const opportunity = Math.min(
    100,
    Math.max(0, Math.round((depthOrder === 1 ? 68 : 32) + (age < 25 ? 20 : age < 28 ? 10 : 0)))
  );

  const volatility = Math.min(
    100,
    Math.max(0, Math.round(38 + (yearsExp < 3 ? 24 : yearsExp < 5 ? 10 : 0) + (depthOrder > 1 ? 14 : 0)))
  );

  const posLabel = raw.depth_chart_position ?? pos;
  const rosterSlot = `${posLabel}${depthOrder}`;

  const imageUrl = raw.espn_id
    ? `https://a.espncdn.com/i/headshots/nfl/players/full/${raw.espn_id}.png`
    : derivePlaceholderImageUrl(id);
  const imageSource = raw.espn_id ? "ESPN headshot CDN" : "Sleeper headshot CDN";

  const source: SourceMeta = {
    source: "Sleeper public players API",
    fetchedAt,
    ttlSeconds: 86_400,
    freshness: "fresh",
    confidence: 0.35,
    validation: "valid",
    missingFields: ["market_value", "true_value", "ownership", "narrative_pressure"],
    assumptions: [
      "perceivedValue and trueValue are position-tier + depth-chart estimates; no real pricing data is available from Sleeper's public API.",
      "fragility is derived from Sleeper injury_status field.",
      "ownershipLeverage and narrativePressure default to 0; no behavioral-market data is in this adapter.",
    ],
    failure: null,
  };

  return {
    id,
    name,
    position: pos,
    team: raw.team ?? null,
    perceivedValue,
    trueValue,
    ownershipLeverage: 0,
    fragility,
    narrativePressure: 0,
    volatility,
    opportunity,
    confidence: 0.35,
    rosterSlot,
    status: deriveStatus(raw),
    imageUrl,
    imageSource,
    sources: [source],
  };
}

export async function loadRAEEnvelope(
  options: { allowFixtures?: boolean; fetcher?: typeof fetch } = {}
): Promise<RAEEnvelope> {
  const fetcher = options.fetcher ?? fetch;
  const fetchedAt = new Date().toISOString();

  try {
    const response = await fetcher(SLEEPER_PLAYERS_URL, {
      next: { revalidate: 86_400 },
    });
    if (!response.ok) throw new Error(`Sleeper returned ${response.status}`);

    const raw: unknown = await response.json();
    const parsed = SleeperPlayersSchema.parse(raw);

    const records: PlayerMarketRecord[] = Object.entries(parsed)
      .filter(([, player]) => {
        const isActive = player.active === true;
        const isSkill = SKILL_POSITIONS.has(String(player.position ?? ""));
        const hasTeam = Boolean(player.team);
        const isRelevantDepth = (player.depth_chart_order ?? 99) <= 3;
        return isActive && isSkill && hasTeam && isRelevantDepth;
      })
      .map(([id, player]) => toPlayerMarketRecord(id, player, fetchedAt))
      .filter((r): r is PlayerMarketRecord => r !== null)
      .sort((a, b) => {
        const posOrder = ["QB", "RB", "WR", "TE"];
        const pa = posOrder.indexOf(a.position);
        const pb = posOrder.indexOf(b.position);
        return pa !== pb ? pa - pb : a.perceivedValue - b.perceivedValue;
      })
      .slice(0, 120);

    if (records.length === 0) {
      if (options.allowFixtures) return RAEEnvelopeSchema.parse(fixtureEnvelope());
      return {
        mode: "unavailable",
        generatedAt: fetchedAt,
        records: [],
        sourceState: {
          source: "Sleeper public players API",
          fetchedAt,
          ttlSeconds: 86_400,
          freshness: "missing",
          confidence: 0,
          validation: "valid",
          missingFields: ["market_value", "true_value", "ownership", "narrative_pressure", "depth_chart_order"],
          assumptions: [
            "Sleeper returned no active skill players with depth chart data.",
            "RAE refuses to fabricate market intelligence from empty records.",
          ],
          failure: "No active skill players with depth chart data found.",
        },
      };
    }

    const sourceState: SourceMeta = {
      source: "Sleeper public players API",
      fetchedAt,
      ttlSeconds: 86_400,
      freshness: "fresh",
      confidence: 0.35,
      validation: "valid",
      missingFields: ["market_value", "true_value", "ownership", "narrative_pressure"],
      assumptions: [
        "Market metrics are derived from position tier and depth-chart data; no proprietary pricing source is connected.",
        "Confidence is set to 0.35 to reflect estimated rather than measured market values.",
      ],
      failure: null,
    };

    return RAEEnvelopeSchema.parse({
      mode: "live",
      generatedAt: fetchedAt,
      records,
      sourceState,
    });
  } catch (error) {
    if (options.allowFixtures) return RAEEnvelopeSchema.parse(fixtureEnvelope());
    return {
      mode: "unavailable",
      generatedAt: fetchedAt,
      records: [],
      sourceState: unavailableSource(
        "Sleeper public players API",
        error instanceof Error ? error.message : "Unknown adapter failure"
      ),
    };
  }
}
