import type { PlayerMarketRecord } from "../governance";
import { espnPlayerToRecord, sleeperPlayerToRecord } from "../normalize";
import { getLeagueCredentials, getLeagueForUser, type LeagueRecord, type DecryptedCredentials } from "../leagues";
import { EspnClient } from "../espn/client";
import { getLeague as getEspnLeague } from "../espn/league";
import {
  getLeague as getSleeperLeague,
  getLeagueUsers as getSleeperUsers,
  getRosters as getSleeperRosters
} from "../sleeper/league";
import { getDraft as getSleeperDraft } from "../sleeper/drafts";
import { getLatestPlayersSnapshot } from "../sleeper/snapshot";
import type { SleeperPlayersMap, SleeperRoster } from "../sleeper/schemas";
import type { EspnTeam } from "../espn/schemas";
import { unavailableSource, type SourceMeta } from "../governance";
import { parseEspnFormat, parseSleeperFormat, type LeagueFormat } from "../trade/format";
import { getDb, type Db } from "../../db";
import {
  classifyInjuryEvidence,
  describeInjuryEvidence,
  PLAYERS_SNAPSHOT_CONTRACT,
  type InjuryEvidence
} from "./injuryEvidence";

export interface LiveLeagueSnapshot {
  league: LeagueRecord;
  /** Roster records for every team in the league. Empty when the source is unavailable. */
  allRosters: PlayerMarketRecord[][];
  /** The user's own team's roster, when identifiable. */
  myRoster: PlayerMarketRecord[];
  /**
   * Whether `myRoster` genuinely belongs to THIS user.
   *
   * Audit 2026-08-22. Both platform paths fall back to team index 0 when
   * identity cannot be resolved — a Sleeper user who omits `sleeperUsername`
   * (it is `.optional()`) or renames themselves, or an ESPN co-manager whose
   * SWID is not in `primaryOwner`/`owners`. Nothing recorded the substitution,
   * so every panel, simulation, trade grade and keeper price was computed
   * against a STRANGER'S roster and presented as the user's own — stamped
   * `validation: "valid"`, with no banner.
   *
   * The fallback is kept: it is genuinely useful for a commissioner viewing a
   * league they have no team in. It is now DECLARED, so the UI can say whose
   * roster it is showing rather than implying it is yours.
   */
  identityResolved: boolean;
  /**
   * Non-null ONLY when another team's roster is being shown in place of the
   * user's. Degraded paths returning an empty roster leave this null — nothing
   * is misattributed, so there is nothing to warn about. Warn on this being
   * non-null, not on `identityResolved` alone.
   */
  identityNote: string | null;
  source: SourceMeta;
  failure: string | null;
  /**
   * The league's parsed format settings (scoring, starter slots, trade
   * deadline, playoff weeks). Null when the upstream payload was missing or
   * malformed enough that parseSleeperFormat / parseEspnFormat fell back to
   * defaults — null lets the UI render "Connect a league to audit settings"
   * rather than 12-team-PPR defaults that wouldn't match the user's league.
   */
  format: LeagueFormat | null;
  /**
   * The user's own roster's FAAB budget remaining as a ratio of total budget
   * (0..1). Null when the league doesn't use FAAB, when the values cannot be
   * extracted from the upstream payload, or when the platform doesn't expose
   * the field (ESPN). Consumed by the lifecycle cron's FAAB-depleted rule.
   */
  myFaabRemainingRatio: number | null;
  /**
   * The raw upstream league payload (Sleeper league object / ESPN settings),
   * so the season-mirror + draft-state derivation can read `status`,
   * `previous_league_id`, `season`, etc. without re-fetching. Null on failure.
   */
  leagueRawData: Record<string, unknown> | null;
  /**
   * The Sleeper draft object's `status` ("pre_draft"|"drafting"|"complete"),
   * used as the backup draft-state signal. Null for ESPN / when no draft_id.
   */
  draftStatus: string | null;
  /**
   * How much is actually known about injury/activity status for this snapshot
   * (audit 2026-08-20 §8/§9).
   *
   * Roster membership and injury status come from DIFFERENT upstreams with
   * different ages: membership from the live rosters call, status from the daily
   * players snapshot. A single freshness value cannot describe both, and the
   * lifecycle engine must not resolve an injury alert on the strength of a
   * readable roster. For ESPN this is `verified` on a successful fetch, because
   * ESPN returns `injuryStatus` INLINE with the roster payload rather than from a
   * separately-aged snapshot — see fetchEspnLive.
   */
  injuryEvidence: InjuryEvidence;
}

/**
 * Pure helper — extract the user's FAAB-remaining ratio (0..1) from Sleeper's
 * league + roster settings. Returns null when the league isn't FAAB-style
 * (waiver_type 0 = rolling, 1 = reverse standings), when the total budget is
 * missing or non-positive, when the per-roster `waiver_budget_used` is absent,
 * or when the computed ratio falls outside [0, 1] (which would indicate
 * upstream corruption rather than a real condition).
 *
 * Exported so it can be unit-tested without spinning up a Sleeper fetch.
 */
export function extractSleeperFaabRatio(
  leagueSettings: Record<string, unknown> | null | undefined,
  rosterSettings: Record<string, unknown> | null | undefined
): number | null {
  if (!leagueSettings || !rosterSettings) return null;
  const totalRaw = leagueSettings.waiver_budget;
  const usedRaw = rosterSettings.waiver_budget_used;
  const total = typeof totalRaw === "number" ? totalRaw : null;
  const used = typeof usedRaw === "number" ? usedRaw : 0; // Sleeper omits this when 0
  if (total === null || total <= 0) return null;
  const remaining = total - used;
  if (remaining < 0 || remaining > total) return null;
  return remaining / total;
}

/**
 * Pure helper — extract the user's FAAB-remaining ratio (0..1) from ESPN's
 * league settings + the user's team. ESPN exposes FAAB as
 * `settings.acquisitionSettings.{isUsingAcquisitionBudget, acquisitionBudget}`
 * and per-team `transactionCounter.acquisitionBudgetSpent`. Returns null unless
 * the league explicitly uses an acquisition budget (so we never surface FAAB
 * for a non-FAAB ESPN league), the total is positive, and the computed ratio is
 * a sane [0, 1]. Exported for unit testing without an ESPN fetch.
 */
export function extractEspnFaabRatio(
  leagueSettings: Record<string, unknown> | null | undefined,
  team: Record<string, unknown> | null | undefined
): number | null {
  if (!leagueSettings || !team) return null;
  const acqRaw = leagueSettings.acquisitionSettings;
  if (!acqRaw || typeof acqRaw !== "object") return null;
  const acq = acqRaw as Record<string, unknown>;
  // Only FAAB-budget leagues. A non-FAAB league must not surface a ratio.
  if (acq.isUsingAcquisitionBudget !== true) return null;
  const total = typeof acq.acquisitionBudget === "number" ? acq.acquisitionBudget : null;
  if (total === null || total <= 0) return null;
  const tcRaw = team.transactionCounter;
  const spentRaw =
    tcRaw && typeof tcRaw === "object"
      ? (tcRaw as Record<string, unknown>).acquisitionBudgetSpent
      : undefined;
  const spent = typeof spentRaw === "number" ? spentRaw : 0; // omitted ⇒ none spent
  const remaining = total - spent;
  if (remaining < 0 || remaining > total) return null;
  return remaining / total;
}

// ---------------------------------------------------------------------------
// Pure team-identification helpers (exported so they can be unit-tested)
// ---------------------------------------------------------------------------

/**
 * Resolve the Sleeper roster_id for the given username. Looks up the user in
 * the league-users list by matching `display_name` or `username` (case-
 * insensitive), then finds the roster that has that `owner_id`.
 *
 * Returns `null` when the username is blank or no match is found — callers
 * should fall back to roster 0 and log a warning.
 */
export function resolveSleeperRosterId(
  users: ReadonlyArray<{ user_id: string; username?: string | null; display_name?: string | null }>,
  rosters: ReadonlyArray<{ roster_id: number; owner_id: string | null }>,
  username: string | null | undefined
): number | null {
  if (!username) return null;
  const lower = username.toLowerCase();
  const match = users.find(
    (u) =>
      (u.username?.toLowerCase() ?? "") === lower ||
      (u.display_name?.toLowerCase() ?? "") === lower
  );
  if (!match) return null;
  const roster = rosters.find((r) => r.owner_id === match.user_id);
  return roster?.roster_id ?? null;
}

/**
 * Resolve the ESPN team for the given SWID. ESPN's `mTeam` view includes a
 * top-level `members` array; each member has an `id` (the braced SWID) and an
 * `isLeagueManager` flag. The team object itself contains a `primaryOwner`
 * string (SWID) and/or `owners` array of SWIDs.
 *
 * We normalise the SWID to the braced form (`{...}`) before comparing so that
 * bare and braced values both match.
 *
 * Returns the matched team, or `null` when no match is found (caller falls
 * back to the first team).
 */
export function resolveEspnTeam(
  teams: ReadonlyArray<EspnTeam & { primaryOwner?: string | null; owners?: string[] | null }>,
  swid: string | null | undefined
): (EspnTeam & { primaryOwner?: string | null; owners?: string[] | null }) | null {
  if (!swid) return null;
  const normalised = normaliseSWID(swid);
  for (const team of teams) {
    // Check primaryOwner field
    if (team.primaryOwner && normaliseSWID(team.primaryOwner) === normalised) return team;
    // Check owners array (some ESPN responses use this instead)
    if (team.owners?.some((o) => normaliseSWID(o) === normalised)) return team;
  }
  return null;
}

function normaliseSWID(swid: string): string {
  const t = swid.trim();
  if (t.startsWith("{") && t.endsWith("}")) return t.toUpperCase();
  return `{${t.toUpperCase()}}`;
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

/**
 * Server-only. Decrypts league credentials once, calls the right adapter, and
 * returns the user's roster + every roster in the league, normalized into
 * `PlayerMarketRecord`s. Used by the league-refresh route AND the lifecycle
 * cron so the rules engine sees real data.
 */
export async function fetchLeagueLive(
  userId: string,
  leagueId: string,
  db: Db = getDb()
): Promise<LiveLeagueSnapshot | null> {
  const league = await getLeagueForUser(db, userId, leagueId);
  if (!league) return null;

  if (league.platform === "sleeper") {
    return fetchSleeperLive(league);
  }

  // Decrypt credentials exactly once and pass the value down.
  const creds = await getLeagueCredentials(db, league.id);
  if (!creds) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      identityResolved: false,
      identityNote: null,
      source: unavailableSource(`ESPN league ${league.externalLeagueId}`, "missing credentials"),
      failure: "missing credentials",
      format: null,
      myFaabRemainingRatio: null,
      leagueRawData: null,
      draftStatus: null,
      injuryEvidence: { state: "unavailable", reason: "ESPN credentials missing" }
    };
  }
  return fetchEspnLive(league, creds);
}

async function fetchSleeperLive(league: LeagueRecord): Promise<LiveLeagueSnapshot> {
  const [info, rosters, users, snapshot] = await Promise.all([
    getSleeperLeague(league.externalLeagueId),
    getSleeperRosters(league.externalLeagueId),
    getSleeperUsers(league.externalLeagueId),
    getLatestPlayersSnapshot()
  ]);

  // Parse format from whatever league info we got — even when rosters/snapshot
  // are missing, the format is useful so PreDraftAudit can audit settings on
  // a freshly-added pre-draft league that doesn't have rosters yet.
  const format = info.data ? parseSleeperFormat(info.data) : null;
  const leagueRawData = info.data ? (info.data as unknown as Record<string, unknown>) : null;

  if (!info.data || !rosters.data || rosters.data.length === 0) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      identityResolved: false,
      identityNote: null,
      source: info.source.freshness === "unavailable" ? info.source : rosters.source,
      failure: info.source.failure ?? rosters.source.failure ?? "no rosters returned",
      format,
      myFaabRemainingRatio: null,
      leagueRawData,
      draftStatus: null,
      // No roster at all: status is not merely stale, it is unknown.
      injuryEvidence: {
        state: "unavailable",
        reason: info.source.failure ?? rosters.source.failure ?? "no rosters returned"
      }
    };
  }
  if (!snapshot) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      identityResolved: false,
      identityNote: null,
      source: unavailableSource(
        `Sleeper league ${league.externalLeagueId}`,
        "no players snapshot — run /api/cron/players-refresh first"
      ),
      failure: "no players snapshot",
      format,
      myFaabRemainingRatio: null,
      leagueRawData,
      draftStatus: null,
      // The snapshot IS the injury source. Without it there is no status at all.
      injuryEvidence: classifyInjuryEvidence(null)
    };
  }

  const playersMap: SleeperPlayersMap = snapshot.players;
  const sleeperRosters: SleeperRoster[] = rosters.data;
  const leagueUsers = users.data ?? [];

  // Audit 2026-08-20 §8: the snapshot's OWN age decides what can be claimed
  // about injury status. `snapshot.fetchedAt` was in scope here before and was
  // simply dropped on the floor.
  const rosterFetchedAt = rosters.source.fetchedAt
    ? new Date(rosters.source.fetchedAt)
    : new Date();
  const injuryEvidence = classifyInjuryEvidence(snapshot.fetchedAt);
  const provenance = {
    rosterFetchedAt,
    playersSnapshotFetchedAt: snapshot.fetchedAt,
    injuryEvidence
  };

  // Resolve the user's roster_id via stored Sleeper username; fall back to
  // the first roster when the username is absent or unresolvable.
  const resolvedRosterId = resolveSleeperRosterId(leagueUsers, sleeperRosters, league.sleeperUsername);
  const myTeamId = resolvedRosterId ?? sleeperRosters[0]?.roster_id ?? null;
  // Declare the substitution rather than performing it silently.
  const sleeperIdentityResolved = resolvedRosterId != null;
  const sleeperIdentityNote =
    sleeperIdentityResolved || sleeperRosters.length === 0
      ? null
      : league.sleeperUsername
        ? `Could not match Sleeper user "${league.sleeperUsername}" to a team in this league — showing the first team instead.`
        : "No Sleeper username is saved for this league, so your team could not be identified — showing the first team instead.";

  const allRosters = sleeperRosters.map((r) =>
    materializeSleeperRoster(r, playersMap, league, provenance)
  );
  const myRosterRow = sleeperRosters.find((r) => r.roster_id === myTeamId);
  const myRoster = myRosterRow
    ? materializeSleeperRoster(myRosterRow, playersMap, league, provenance)
    : [];

  const myFaabRemainingRatio = myRosterRow
    ? extractSleeperFaabRatio(
        info.data.settings ?? null,
        myRosterRow.settings ?? null
      )
    : null;

  // Backup draft-state signal: fetch the draft object's status. Bounded +
  // fails open so a slow/missing draft endpoint never blocks the homepage.
  const draftId = info.data.draft_id ?? null;
  const draft = draftId ? await getSleeperDraft(draftId).catch(() => null) : null;
  const draftStatus = draft?.data?.status ?? null;

  return {
    league,
    allRosters,
    myRoster,
    identityResolved: sleeperIdentityResolved,
    identityNote: sleeperIdentityNote,
    source: rosters.source,
    failure: null,
    format,
    myFaabRemainingRatio,
    leagueRawData,
    draftStatus,
    injuryEvidence
  };
}

/** The two upstreams a Sleeper roster record is composed from. */
export interface SleeperRosterProvenance {
  /** When the live rosters call returned — governs MEMBERSHIP only. */
  rosterFetchedAt: Date;
  /** When the daily players snapshot was taken — governs identity + injury status. */
  playersSnapshotFetchedAt: Date | null;
  /** Derived from the snapshot age; the decision-relevant part. */
  injuryEvidence: InjuryEvidence;
}

/** Roster membership is a live read; 2 minutes is a genuine TTL for it. */
const ROSTER_TTL_SECONDS = 120;

/**
 * Materialize one Sleeper roster into records with HONEST composite provenance.
 *
 * Audit 2026-08-20 §8. Every record used to be stamped
 * `fetchedAt: now, ttlSeconds: 120, freshness: "fresh", validation: "valid"` —
 * but the `injury_status`, position and team on it all came from the daily
 * players snapshot, whose age was discarded by the caller. A roster read now
 * plus a snapshot from 36 hours ago produced a record asserting a two-minute-old
 * injury status. Consumers (`sources[0]`) then reported that assertion to the
 * user as source freshness.
 *
 * Now `sources` is ordered [composite, membership, player-metadata]:
 *
 *  - `sources[0]` is the DECISION source, and is bounded by the OLDEST
 *    decision-relevant input — that is the whole invariant. Its freshness is the
 *    worse of the two, its `fetchedAt` the earlier of the two, its `ttlSeconds`
 *    the smaller of the two.
 *  - `sources[1]` and `sources[2]` retain each input's own timestamp so nothing
 *    is lost by the composition.
 */
export function materializeSleeperRoster(
  roster: SleeperRoster,
  playersMap: SleeperPlayersMap,
  league: LeagueRecord,
  provenance: SleeperRosterProvenance
): PlayerMarketRecord[] {
  const { rosterFetchedAt, playersSnapshotFetchedAt, injuryEvidence } = provenance;

  const membership: SourceMeta = {
    source: `Sleeper roster ${league.externalLeagueId} (membership)`,
    fetchedAt: rosterFetchedAt.toISOString(),
    ttlSeconds: ROSTER_TTL_SECONDS,
    freshness: "fresh",
    confidence: 0.85,
    validation: "valid",
    missingFields: [],
    assumptions: ["Live Sleeper rosters call — proves who is on the roster, nothing more."],
    failure: null
  };

  const metadata: SourceMeta = {
    source: "Sleeper players snapshot (identity, position, injury status)",
    fetchedAt: playersSnapshotFetchedAt ? playersSnapshotFetchedAt.toISOString() : null,
    ttlSeconds: PLAYERS_SNAPSHOT_CONTRACT.warnAfterSeconds,
    freshness:
      injuryEvidence.state === "verified"
        ? "fresh"
        : injuryEvidence.state === "stale"
          ? "stale"
          : "missing",
    confidence: injuryEvidence.state === "verified" ? 0.85 : 0.4,
    validation: injuryEvidence.state === "unavailable" ? "not-run" : "valid",
    missingFields: injuryEvidence.state === "unavailable" ? ["status"] : [],
    assumptions: [describeInjuryEvidence(injuryEvidence)],
    failure:
      injuryEvidence.state === "unavailable"
        ? `injury/activity status not verifiable — ${injuryEvidence.reason}`
        : null
  };

  // The composite can never be fresher than its oldest important input.
  const oldest =
    playersSnapshotFetchedAt && playersSnapshotFetchedAt < rosterFetchedAt
      ? playersSnapshotFetchedAt
      : rosterFetchedAt;
  const composite: SourceMeta = {
    source: `Sleeper roster ${league.externalLeagueId} + players snapshot`,
    // A missing snapshot means the record's status half has NO timestamp; the
    // composite must not borrow the roster's.
    fetchedAt: playersSnapshotFetchedAt ? oldest.toISOString() : null,
    ttlSeconds: Math.min(ROSTER_TTL_SECONDS, PLAYERS_SNAPSHOT_CONTRACT.warnAfterSeconds),
    freshness: metadata.freshness,
    confidence: Math.min(membership.confidence, metadata.confidence),
    validation: metadata.validation,
    missingFields: metadata.missingFields,
    assumptions: [
      "Sleeper identity + roster; no market metrics.",
      "Composite record: roster membership and injury status come from different upstreams; this freshness is bounded by the older one.",
      describeInjuryEvidence(injuryEvidence)
    ],
    failure: metadata.failure
  };

  const ids = roster.players ?? [];
  const records: PlayerMarketRecord[] = [];
  for (const id of ids) {
    const player = playersMap[id];
    if (!player) continue;
    const record = sleeperPlayerToRecord(id, player, { source: composite });
    if (record) records.push(record);
  }
  // sources[0] stays the decision source (DraftIntelligence + runNexusSimulation
  // read it); the per-input entries are appended so provenance is not lost.
  return records.map((r) => ({ ...r, sources: [...r.sources, membership, metadata] }));
}

async function fetchEspnLive(
  league: LeagueRecord,
  creds: DecryptedCredentials
): Promise<LiveLeagueSnapshot> {
  const client = new EspnClient({ credentials: creds });
  const result = await getEspnLeague(
    client,
    { leagueId: league.externalLeagueId, season: league.season },
    ["mTeam", "mRoster", "mSettings"]
  );

  // Parse format from mSettings even when teams are missing; PreDraftAudit
  // can still surface scoring + starter slots on a fresh pre-draft league.
  const format = result.data?.settings ? parseEspnFormat(result.data.settings) : null;

  const espnRawData = result.data?.settings
    ? (result.data.settings as unknown as Record<string, unknown>)
    : null;

  if (!result.data || !result.data.teams || result.data.teams.length === 0) {
    return {
      league,
      allRosters: [],
      myRoster: [],
      identityResolved: false,
      identityNote: null,
      source: result.source,
      failure: result.source.failure ?? "no teams returned",
      format,
      myFaabRemainingRatio: null,
      leagueRawData: espnRawData,
      draftStatus: null,
      injuryEvidence: {
        state: "unavailable",
        reason: result.source.failure ?? "no teams returned"
      }
    };
  }

  const baseSource = {
    source: `ESPN league ${league.externalLeagueId}`,
    fetchedAt: new Date().toISOString(),
    ttlSeconds: 300,
    freshness: "fresh" as const,
    confidence: 0.85,
    validation: "valid" as const,
    missingFields: [],
    assumptions: ["ESPN identity + roster; no market metrics."],
    failure: null
  };

  // ESPN `mTeam` data returns teams with `primaryOwner` / `owners` fields
  // containing the SWID of the owner(s). Match the user's SWID (from the
  // decrypted credentials — already available in `creds`) to find their team.
  type EspnTeamWithOwner = EspnTeam & { primaryOwner?: string | null; owners?: string[] | null };
  const espnTeams = result.data.teams as EspnTeamWithOwner[];

  const allRosters: PlayerMarketRecord[][] = espnTeams.map((team) => {
    const entries = team.roster?.entries ?? [];
    const records: PlayerMarketRecord[] = [];
    for (const entry of entries) {
      const player = entry.playerPoolEntry?.player;
      if (!player) continue;
      const record = espnPlayerToRecord(player, { source: baseSource });
      if (record) records.push(record);
    }
    return records;
  });

  // Resolve the user's team via SWID. Fall back to the first team if the SWID
  // doesn't match any team (e.g. co-commissioner viewing another user's data).
  const myTeam = resolveEspnTeam(espnTeams, creds.swid);
  const myTeamIndex = myTeam ? espnTeams.indexOf(myTeam) : 0;
  const myRoster = allRosters[myTeamIndex] ?? [];
  // Declare the substitution rather than performing it silently.
  const espnIdentityResolved = myTeam != null;
  const espnIdentityNote =
    espnIdentityResolved || espnTeams.length === 0
      ? null
      : "Your ESPN account did not match any team in this league — showing the first team instead.";

  return {
    league,
    allRosters,
    myRoster,
    identityResolved: espnIdentityResolved,
    identityNote: espnIdentityNote,
    source: result.source,
    failure: null,
    format,
    // ESPN FAAB: read settings.acquisitionSettings + the user's team
    // transactionCounter. Null for non-FAAB leagues or when the team is
    // unresolved. Feeds the lifecycle FAAB-depleted rule, same as Sleeper.
    myFaabRemainingRatio: extractEspnFaabRatio(
      result.data.settings ?? null,
      myTeam as unknown as Record<string, unknown> | null
    ),
    leagueRawData: espnRawData,
    draftStatus: null,
    // ESPN returns `injuryStatus` inline on each roster entry, so its age is the
    // age of THIS call — not of a separately-refreshed snapshot. A successful
    // fetch therefore does carry verified injury evidence.
    injuryEvidence: espnInjuryEvidence(result.source)
  };
}

/**
 * ESPN injury evidence from the roster call's own SourceMeta.
 *
 * Unlike Sleeper there is no second upstream to bound: status ships with the
 * roster. But a served-from-cache or degraded ESPN response must not be promoted
 * to `verified`, so the call's declared freshness still governs.
 */
function espnInjuryEvidence(source: SourceMeta): InjuryEvidence {
  if (source.fetchedAt == null) {
    return { state: "unavailable", reason: "ESPN response carried no fetch timestamp" };
  }
  const ageSeconds = Math.max(0, (Date.now() - new Date(source.fetchedAt).getTime()) / 1000);
  if (source.freshness === "fresh") {
    return { state: "verified", fetchedAt: source.fetchedAt, ageSeconds };
  }
  if (source.freshness === "stale") {
    return { state: "stale", fetchedAt: source.fetchedAt, ageSeconds };
  }
  return { state: "unavailable", reason: `ESPN roster freshness "${source.freshness}"` };
}
