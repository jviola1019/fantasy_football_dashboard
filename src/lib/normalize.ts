import type { PlayerMarketRecord, SourceMeta } from "./governance";
import type { SleeperPlayer } from "./sleeper/schemas";
import { sleeperHeadshotUrl, sleeperFullName } from "./sleeper/players";
import { espnLineupSlot, espnPosition, espnProTeam } from "./espn/positions";
import type { EspnPlayerCore, EspnRosterEntry } from "./espn/schemas";

const ALLOWED_POSITIONS = new Set<PlayerMarketRecord["position"]>(["QB", "RB", "WR", "TE", "K", "DEF"]);

const ESPN_HEADSHOT_BASE = "https://a.espncdn.com/i/headshots/nfl/players/full";

export interface NormalizeContext {
  source: SourceMeta;
  rosterSlot?: string;
}

export function sleeperPlayerToRecord(
  playerId: string,
  player: SleeperPlayer,
  context: NormalizeContext
): PlayerMarketRecord | null {
  const position = normalizePosition(player.position ?? null);
  if (!position) return null;
  const team = (player.team && player.team.trim().length ? player.team : null) ?? null;
  return {
    id: `sleeper:${playerId}`,
    name: sleeperFullName({ ...player, player_id: playerId }),
    position,
    team,
    perceivedValue: 0,
    trueValue: 0,
    ownershipLeverage: 0,
    fragility: 0,
    narrativePressure: 0,
    volatility: 0,
    opportunity: 0,
    confidence: 0,
    sources: [withMissingMarketFields(context.source)],
    rosterSlot: context.rosterSlot ?? "FLEX",
    status: mapSleeperStatus(player.injury_status, player.active),
    imageUrl: sleeperHeadshotUrl(playerId),
    imageSource: "Sleeper headshot CDN"
  };
}

export function espnRosterEntryToRecord(
  entry: EspnRosterEntry,
  context: NormalizeContext
): PlayerMarketRecord | null {
  const player = entry.playerPoolEntry?.player;
  if (!player) return null;
  return espnPlayerToRecord(player, {
    ...context,
    rosterSlot: context.rosterSlot ?? espnLineupSlot(entry.lineupSlotId ?? null)
  });
}

export function espnPlayerToRecord(
  player: EspnPlayerCore,
  context: NormalizeContext
): PlayerMarketRecord | null {
  const position = espnPosition(player.defaultPositionId ?? null);
  if (!position) return null;
  const team = espnProTeam(player.proTeamId ?? null);
  const name = player.fullName ?? [player.firstName, player.lastName].filter(Boolean).join(" ").trim();
  return {
    id: `espn:${player.id}`,
    name: name || `ESPN player ${player.id}`,
    position,
    team: team === "FA" ? null : team,
    perceivedValue: 0,
    trueValue: 0,
    ownershipLeverage: 0,
    fragility: 0,
    narrativePressure: 0,
    volatility: 0,
    opportunity: 0,
    confidence: 0,
    sources: [withMissingMarketFields(context.source)],
    rosterSlot: context.rosterSlot ?? "FLEX",
    status: mapEspnStatus(player.injuryStatus, player.active),
    imageUrl: `${ESPN_HEADSHOT_BASE}/${player.id}.png`,
    imageSource: "ESPN headshot CDN"
  };
}

function normalizePosition(raw: string | null): PlayerMarketRecord["position"] | null {
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (upper === "DST" || upper === "D/ST") return "DEF";
  return ALLOWED_POSITIONS.has(upper as PlayerMarketRecord["position"])
    ? (upper as PlayerMarketRecord["position"])
    : null;
}

function mapSleeperStatus(injury: string | null | undefined, active: boolean | null | undefined): PlayerMarketRecord["status"] {
  if (active === false) return "unknown";
  if (!injury) return "active";
  const lower = injury.toLowerCase();
  if (lower.includes("out")) return "out";
  if (lower.includes("questionable") || lower.includes("doubtful")) return "questionable";
  if (lower.includes("ir") || lower.includes("injured")) return "ir";
  if (lower.includes("bye")) return "bye";
  return "active";
}

function mapEspnStatus(injury: string | null | undefined, active: boolean | null | undefined): PlayerMarketRecord["status"] {
  if (active === false) return "unknown";
  if (!injury) return "active";
  const upper = injury.toUpperCase();
  if (upper === "OUT") return "out";
  if (upper === "QUESTIONABLE" || upper === "DOUBTFUL") return "questionable";
  if (upper === "INJURY_RESERVE" || upper === "IR") return "ir";
  if (upper === "BYE") return "bye";
  return "active";
}

function withMissingMarketFields(source: SourceMeta): SourceMeta {
  const additions = ["market_value", "true_value", "ownership", "narrative_pressure", "fragility", "opportunity"];
  const dedup = new Set(source.missingFields);
  for (const field of additions) dedup.add(field);
  return {
    ...source,
    missingFields: Array.from(dedup),
    assumptions: source.assumptions.length
      ? source.assumptions
      : [
          "Identity-only adapter; behavioral-market metrics default to 0 and must not be presented as live signal.",
          "RAE refuses to fabricate market intelligence from identity records alone."
        ]
  };
}
