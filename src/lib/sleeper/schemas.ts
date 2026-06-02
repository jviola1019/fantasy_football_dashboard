import { z } from "zod";

export const SleeperPlayerSchema = z
  .object({
    player_id: z.string().optional(),
    full_name: z.string().optional().nullable(),
    first_name: z.string().optional().nullable(),
    last_name: z.string().optional().nullable(),
    position: z.string().optional().nullable(),
    team: z.string().optional().nullable(),
    active: z.boolean().optional().nullable(),
    age: z.number().int().nullable().optional(),
    years_exp: z.number().int().nullable().optional(),
    injury_status: z.string().nullable().optional(),
    fantasy_positions: z.array(z.string()).nullable().optional()
  })
  .passthrough();
export type SleeperPlayer = z.infer<typeof SleeperPlayerSchema>;

export const SleeperPlayersMapSchema = z.record(z.string(), SleeperPlayerSchema);
export type SleeperPlayersMap = z.infer<typeof SleeperPlayersMapSchema>;

export const SleeperTrendingEntrySchema = z.object({
  player_id: z.string(),
  count: z.number().int()
});
export const SleeperTrendingListSchema = z.array(SleeperTrendingEntrySchema);

export const SleeperUserSchema = z
  .object({
    user_id: z.string(),
    username: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
    avatar: z.string().nullable().optional()
  })
  .passthrough();
export type SleeperUser = z.infer<typeof SleeperUserSchema>;

export const SleeperLeagueSchema = z
  .object({
    league_id: z.string(),
    name: z.string(),
    season: z.string(),
    sport: z.string(),
    status: z.string().nullable().optional(),
    total_rosters: z.number().int(),
    settings: z.record(z.string(), z.unknown()).nullable().optional(),
    scoring_settings: z.record(z.string(), z.unknown()).nullable().optional(),
    roster_positions: z.array(z.string()).nullable().optional(),
    draft_id: z.string().nullable().optional(),
    // Year-chain link to the prior season's league (Sleeper renewal). Lets the
    // season-mirror tell a brand-new league (no history) from a renewal.
    previous_league_id: z.string().nullable().optional()
  })
  .passthrough();
export type SleeperLeague = z.infer<typeof SleeperLeagueSchema>;
export const SleeperLeagueListSchema = z.array(SleeperLeagueSchema);

export const SleeperRosterSchema = z
  .object({
    roster_id: z.number().int(),
    owner_id: z.string().nullable(),
    league_id: z.string(),
    players: z.array(z.string()).nullable().optional(),
    starters: z.array(z.string()).nullable().optional(),
    reserve: z.array(z.string()).nullable().optional(),
    taxi: z.array(z.string()).nullable().optional(),
    settings: z.record(z.string(), z.unknown()).nullable().optional()
  })
  .passthrough();
export type SleeperRoster = z.infer<typeof SleeperRosterSchema>;
export const SleeperRosterListSchema = z.array(SleeperRosterSchema);

export const SleeperLeagueUserSchema = SleeperUserSchema.extend({
  metadata: z.record(z.string(), z.unknown()).nullable().optional(),
  is_owner: z.boolean().nullable().optional()
});
export const SleeperLeagueUserListSchema = z.array(SleeperLeagueUserSchema);

export const SleeperMatchupSchema = z
  .object({
    roster_id: z.number().int(),
    matchup_id: z.number().int().nullable().optional(),
    points: z.number().nullable().optional(),
    starters: z.array(z.string()).nullable().optional(),
    players: z.array(z.string()).nullable().optional()
  })
  .passthrough();
export const SleeperMatchupListSchema = z.array(SleeperMatchupSchema);

export const SleeperTransactionSchema = z
  .object({
    transaction_id: z.string(),
    type: z.string(),
    status: z.string(),
    creator: z.string().nullable().optional(),
    roster_ids: z.array(z.number().int()).nullable().optional(),
    adds: z.record(z.string(), z.number().int()).nullable().optional(),
    drops: z.record(z.string(), z.number().int()).nullable().optional(),
    draft_picks: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
    created: z.number().int().nullable().optional()
  })
  .passthrough();
export const SleeperTransactionListSchema = z.array(SleeperTransactionSchema);

export const SleeperTradedPickSchema = z
  .object({
    season: z.string(),
    round: z.number().int(),
    roster_id: z.number().int(),
    previous_owner_id: z.number().int(),
    owner_id: z.number().int()
  })
  .passthrough();
export const SleeperTradedPickListSchema = z.array(SleeperTradedPickSchema);

export const SleeperBracketMatchSchema = z
  .object({
    r: z.number().int(),
    m: z.number().int(),
    t1: z.number().int().nullable().optional(),
    t2: z.number().int().nullable().optional(),
    w: z.number().int().nullable().optional(),
    l: z.number().int().nullable().optional()
  })
  .passthrough();
export const SleeperBracketSchema = z.array(SleeperBracketMatchSchema);

export const SleeperDraftSchema = z
  .object({
    draft_id: z.string(),
    league_id: z.string().nullable().optional(),
    season: z.string(),
    status: z.string(),
    type: z.string(),
    settings: z.record(z.string(), z.unknown()).nullable().optional(),
    draft_order: z.record(z.string(), z.number().int()).nullable().optional(),
    slot_to_roster_id: z.record(z.string(), z.number().int()).nullable().optional(),
    start_time: z.number().int().nullable().optional()
  })
  .passthrough();
export type SleeperDraft = z.infer<typeof SleeperDraftSchema>;
export const SleeperDraftListSchema = z.array(SleeperDraftSchema);

export const SleeperDraftPickSchema = z
  .object({
    player_id: z.string(),
    picked_by: z.string().nullable().optional(),
    roster_id: z.number().int().nullable().optional(),
    round: z.number().int(),
    draft_slot: z.number().int(),
    pick_no: z.number().int(),
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    is_keeper: z.boolean().nullable().optional()
  })
  .passthrough();
export type SleeperDraftPick = z.infer<typeof SleeperDraftPickSchema>;
export const SleeperDraftPickListSchema = z.array(SleeperDraftPickSchema);

export const SleeperNflStateSchema = z
  .object({
    week: z.number().int(),
    season: z.string(),
    season_type: z.string(),
    league_season: z.string(),
    season_start_date: z.string().nullable().optional(),
    display_week: z.number().int().nullable().optional()
  })
  .passthrough();
export type SleeperNflState = z.infer<typeof SleeperNflStateSchema>;
