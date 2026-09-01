/**
 * Free-agent acquisition budgets (FAAB) — one module, one source of truth.
 *
 * Audit 2026-08-31 (S4). These extractors lived in `fetchLive.ts` and returned
 * a bare RATIO, because the only consumer was the lifecycle cron's
 * `faab-depleted` rule, which compares against 0.1. `/waivers` meanwhile showed
 * *"Free-agent acquisition budgets not connected"* — describing data the app
 * was already fetching, parsing, validating and alerting on.
 *
 * A ratio is the wrong primitive for a UI: nobody bids 0.63, they bid $63. So
 * the extractors now return `{ total, remaining, ratio }` — the dollars are the
 * measured quantity and the ratio is derived from them, rather than the panel
 * re-deriving dollars from a rounded ratio and drifting from the alert that
 * fired. The lifecycle rule reads `.ratio` off the same object the panel draws.
 *
 * Everything here is pure and platform-shaped at the edges only, so both
 * platforms can be tested without a network fetch.
 */

import { z } from "zod";

/**
 * One team's budget, in the league's own currency units (dollars, by
 * convention). Declared as a schema rather than a bare interface because it
 * travels inside `RAEEnvelope`, which is validated on the way in — a shape
 * declared twice is a shape that can disagree with itself.
 */
export const FaabBudgetSchema = z.object({
  /** Sleeper `roster_id` / ESPN team id, as a string. Stable within a league. */
  teamId: z.string(),
  /** Display name for the team's owner, or a positional label when unknown. */
  teamName: z.string(),
  /** True for the signed-in user's team. At most one entry; none when identity is unresolved. */
  isMine: z.boolean(),
  /** Starting budget. Identical across teams in every format either platform supports. */
  total: z.number().positive(),
  /** Budget still available to bid. */
  remaining: z.number().nonnegative(),
  /** `remaining / total`, precomputed so no consumer re-derives it. */
  ratio: z.number().min(0).max(1)
});
export type FaabBudget = z.infer<typeof FaabBudgetSchema>;

/** The league-wide budget picture. Null whenever the league does not use FAAB. */
export const FaabStateSchema = z.object({
  /** The starting budget every team began with. */
  total: z.number().positive(),
  /** Every team whose budget could be read, richest first. */
  budgets: z.array(FaabBudgetSchema),
  /** How many teams the league has, so a partial read can disclose itself. */
  teamCount: z.number().int().nonnegative()
});
export type FaabState = z.infer<typeof FaabStateSchema>;

/** Shared validation: a budget pair is only usable when it is internally coherent. */
function budgetFrom(total: number | null, spent: number): Omit<FaabBudget, "teamId" | "teamName" | "isMine"> | null {
  if (total === null || total <= 0) return null;
  const remaining = total - spent;
  // Outside [0, total] means the upstream disagrees with itself. Surfacing a
  // negative bar, or one over 100%, would be presenting corruption as data.
  if (remaining < 0 || remaining > total) return null;
  return { total, remaining, ratio: remaining / total };
}

/**
 * Sleeper's FAAB value for `settings.waiver_type`.
 *
 * 0 = rolling waiver priority, 1 = reverse standings, 2 = FAAB bidding.
 */
export const SLEEPER_WAIVER_TYPE_FAAB = 2;

/**
 * One Sleeper team's budget from the league + roster settings blobs.
 *
 * **`waiver_budget` alone does not mean the league uses FAAB.** Measured live on
 * 2026-08-31 against both of this account's leagues: `Offline`
 * (`1395917841022074880`, in_season) and `Creamy Les Coot 4.0`
 * (`1389332513259790336`, pre_draft) each report `waiver_type: 0` — rolling
 * waiver priority — and each ALSO reports `waiver_budget: 100`, because Sleeper
 * emits that default for every league whether or not anyone can bid it.
 *
 * The predecessor of this function keyed on `waiver_budget` being present, so it
 * returned a full budget for both. That was harmless while the only consumer was
 * the lifecycle rule (an unused budget sits at 100% and never trips the 10%
 * alert) and became a fabrication the moment S4 drew it as a bar: ten teams,
 * "$100 of $100 left", in a league where no dollar can be spent.
 *
 * So the check is the explicit one, mirroring the ESPN path's requirement that
 * `isUsingAcquisitionBudget` be exactly true. A league we cannot confirm bids
 * with money gets no budget, and the panel names the fields it looked at.
 *
 * Sleeper OMITS `waiver_budget_used` for a roster that has spent nothing, so
 * absent means 0 there.
 */
export function extractSleeperFaabBudget(
  leagueSettings: Record<string, unknown> | null | undefined,
  rosterSettings: Record<string, unknown> | null | undefined
): { total: number; remaining: number; ratio: number } | null {
  if (!leagueSettings || !rosterSettings) return null;
  if (leagueSettings.waiver_type !== SLEEPER_WAIVER_TYPE_FAAB) return null;
  const totalRaw = leagueSettings.waiver_budget;
  const usedRaw = rosterSettings.waiver_budget_used;
  const total = typeof totalRaw === "number" ? totalRaw : null;
  const used = typeof usedRaw === "number" ? usedRaw : 0;
  return budgetFrom(total, used);
}

/**
 * One ESPN team's budget from the league settings + that team object.
 *
 * ESPN exposes FAAB as `settings.acquisitionSettings.{isUsingAcquisitionBudget,
 * acquisitionBudget}` and per-team `transactionCounter.acquisitionBudgetSpent`.
 * The `isUsingAcquisitionBudget` flag must be explicitly true: a league we
 * cannot confirm uses FAAB gets nothing rather than a budget it does not have.
 */
export function extractEspnFaabBudget(
  leagueSettings: Record<string, unknown> | null | undefined,
  team: Record<string, unknown> | null | undefined
): { total: number; remaining: number; ratio: number } | null {
  if (!leagueSettings || !team) return null;
  const acqRaw = leagueSettings.acquisitionSettings;
  if (!acqRaw || typeof acqRaw !== "object") return null;
  const acq = acqRaw as Record<string, unknown>;
  if (acq.isUsingAcquisitionBudget !== true) return null;
  const total = typeof acq.acquisitionBudget === "number" ? acq.acquisitionBudget : null;
  const tcRaw = team.transactionCounter;
  const spentRaw =
    tcRaw && typeof tcRaw === "object"
      ? (tcRaw as Record<string, unknown>).acquisitionBudgetSpent
      : undefined;
  const spent = typeof spentRaw === "number" ? spentRaw : 0;
  return budgetFrom(total, spent);
}

function sortAndFinish(budgets: FaabBudget[], total: number, teamCount: number): FaabState | null {
  if (budgets.length === 0) return null;
  // Richest first: the ordering a manager actually reasons with — who can still
  // outbid me for the player I want.
  budgets.sort((a, b) => b.remaining - a.remaining || a.teamName.localeCompare(b.teamName));
  return { total, budgets, teamCount };
}

/**
 * The whole league's Sleeper budgets. Every roster carries its own
 * `waiver_budget_used`, so this needs no additional fetch — the same payload
 * that resolves rosters already contains it.
 *
 * A roster whose budget cannot be read is OMITTED rather than defaulted, and
 * `teamCount` records how many teams the league has so the panel can say
 * "8 of 10 teams" instead of implying it drew them all.
 */
export function buildSleeperFaabState(
  leagueSettings: Record<string, unknown> | null | undefined,
  rosters: ReadonlyArray<{ roster_id: number; owner_id: string | null; settings?: Record<string, unknown> | null }>,
  users: ReadonlyArray<{ user_id: string; username?: string | null; display_name?: string | null }>,
  myRosterId: number | null
): FaabState | null {
  if (!leagueSettings || rosters.length === 0) return null;
  const nameByUser = new Map(users.map((u) => [u.user_id, u.display_name || u.username || null]));
  const budgets: FaabBudget[] = [];
  let total = 0;
  for (const roster of rosters) {
    const b = extractSleeperFaabBudget(leagueSettings, roster.settings ?? null);
    if (!b) continue;
    total = b.total;
    budgets.push({
      teamId: String(roster.roster_id),
      // An orphaned roster (owner_id null — a team nobody claimed) is real and
      // still holds a budget, so it is labelled by its slot rather than dropped.
      teamName: (roster.owner_id ? nameByUser.get(roster.owner_id) : null) ?? `Team ${roster.roster_id}`,
      isMine: myRosterId != null && roster.roster_id === myRosterId,
      ...b
    });
  }
  return sortAndFinish(budgets, total, rosters.length);
}

/** The whole league's ESPN budgets, from the `mTeam` payload already in hand. */
export function buildEspnFaabState(
  leagueSettings: Record<string, unknown> | null | undefined,
  teams: ReadonlyArray<Record<string, unknown>>,
  myTeamId: number | null
): FaabState | null {
  if (!leagueSettings || teams.length === 0) return null;
  const budgets: FaabBudget[] = [];
  let total = 0;
  for (const team of teams) {
    const b = extractEspnFaabBudget(leagueSettings, team);
    if (!b) continue;
    total = b.total;
    const id = typeof team.id === "number" ? team.id : null;
    budgets.push({
      teamId: id === null ? "?" : String(id),
      teamName: espnTeamName(team) ?? (id === null ? "Unknown team" : `Team ${id}`),
      isMine: myTeamId != null && id === myTeamId,
      ...b
    });
  }
  return sortAndFinish(budgets, total, teams.length);
}

/**
 * ESPN's team name arrives as either a single `name` or a `location` +
 * `nickname` pair depending on the view and the season. Both are tried before
 * falling back to the numeric id.
 */
function espnTeamName(team: Record<string, unknown>): string | null {
  const name = typeof team.name === "string" ? team.name.trim() : "";
  if (name) return name;
  const location = typeof team.location === "string" ? team.location.trim() : "";
  const nickname = typeof team.nickname === "string" ? team.nickname.trim() : "";
  const joined = `${location} ${nickname}`.trim();
  return joined || null;
}

/** The signed-in user's budget within a league-wide state, or null. */
export function myFaabBudget(state: FaabState | null | undefined): FaabBudget | null {
  return state?.budgets.find((b) => b.isMine) ?? null;
}
