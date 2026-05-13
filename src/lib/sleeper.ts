import { z } from "zod";
import { RAEEnvelopeSchema, unavailableSource, type RAEEnvelope } from "./governance";
import { fixtureEnvelope } from "./fixtures";

const SleeperPlayerSchema = z.record(
  z.string(),
  z.object({
    player_id: z.string().optional(),
    full_name: z.string().optional().nullable(),
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    position: z.string().optional().nullable(),
    team: z.string().optional().nullable(),
    active: z.boolean().optional().nullable()
  }).passthrough()
);

export const SLEEPER_PLAYERS_URL = "https://api.sleeper.app/v1/players/nfl";

export async function loadRAEEnvelope(options: { allowFixtures?: boolean; fetcher?: typeof fetch } = {}): Promise<RAEEnvelope> {
  const fetcher = options.fetcher ?? fetch;
  try {
    const response = await fetcher(SLEEPER_PLAYERS_URL, { next: { revalidate: 86_400 } });
    if (!response.ok) throw new Error(`Sleeper returned ${response.status}`);
    const raw: unknown = await response.json();
    const parsed = SleeperPlayerSchema.parse(raw);
    const activeSkillPlayers = Object.entries(parsed)
      .filter(([, player]) => player.active && ["QB", "RB", "WR", "TE"].includes(String(player.position)))
      .slice(0, 0);

    if (activeSkillPlayers.length === 0) {
      if (options.allowFixtures) return RAEEnvelopeSchema.parse(fixtureEnvelope());
      return {
        mode: "unavailable",
        generatedAt: new Date().toISOString(),
        records: [],
        sourceState: {
          source: "Sleeper public players API",
          fetchedAt: new Date().toISOString(),
          ttlSeconds: 86_400,
          freshness: "missing",
          confidence: 0,
          validation: "valid",
          missingFields: ["market_value", "true_value", "ownership", "narrative_pressure"],
          assumptions: [
            "Sleeper player identity data is available, but behavioral-market metrics require additional adapters or uploaded datasets.",
            "RAE refuses to fabricate market intelligence from identity records alone."
          ],
          failure: "Insufficient production metrics for topology and recommendations."
        }
      };
    }
  } catch (error) {
    if (options.allowFixtures) return RAEEnvelopeSchema.parse(fixtureEnvelope());
    return {
      mode: "unavailable",
      generatedAt: new Date().toISOString(),
      records: [],
      sourceState: unavailableSource("Sleeper public players API", error instanceof Error ? error.message : "Unknown adapter failure")
    };
  }

  return RAEEnvelopeSchema.parse(fixtureEnvelope());
}
