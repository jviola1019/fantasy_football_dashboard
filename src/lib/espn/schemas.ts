import { z } from "zod";

export const EspnPlayerCoreSchema = z
  .object({
    id: z.number().int(),
    fullName: z.string().nullable().optional(),
    firstName: z.string().nullable().optional(),
    lastName: z.string().nullable().optional(),
    defaultPositionId: z.number().int().nullable().optional(),
    proTeamId: z.number().int().nullable().optional(),
    injuryStatus: z.string().nullable().optional(),
    active: z.boolean().nullable().optional()
  })
  .passthrough();
export type EspnPlayerCore = z.infer<typeof EspnPlayerCoreSchema>;

export const EspnRosterEntrySchema = z
  .object({
    playerId: z.number().int(),
    lineupSlotId: z.number().int().nullable().optional(),
    playerPoolEntry: z
      .object({
        player: EspnPlayerCoreSchema
      })
      .passthrough()
      .nullable()
      .optional()
  })
  .passthrough();
export type EspnRosterEntry = z.infer<typeof EspnRosterEntrySchema>;

export const EspnTeamSchema = z
  .object({
    id: z.number().int(),
    abbrev: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    nickname: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    record: z.record(z.string(), z.unknown()).nullable().optional(),
    roster: z
      .object({
        entries: z.array(EspnRosterEntrySchema)
      })
      .passthrough()
      .nullable()
      .optional()
  })
  .passthrough();
export type EspnTeam = z.infer<typeof EspnTeamSchema>;

export const EspnDraftPickSchema = z
  .object({
    id: z.number().int().nullable().optional(),
    overallPickNumber: z.number().int().nullable().optional(),
    roundId: z.number().int().nullable().optional(),
    roundPickNumber: z.number().int().nullable().optional(),
    teamId: z.number().int().nullable().optional(),
    playerId: z.number().int().nullable().optional(),
    keeper: z.boolean().nullable().optional()
  })
  .passthrough();

export const EspnScheduleMatchupSchema = z
  .object({
    id: z.number().int().nullable().optional(),
    matchupPeriodId: z.number().int().nullable().optional(),
    home: z
      .object({
        teamId: z.number().int().nullable().optional(),
        totalPoints: z.number().nullable().optional()
      })
      .passthrough()
      .nullable()
      .optional(),
    away: z
      .object({
        teamId: z.number().int().nullable().optional(),
        totalPoints: z.number().nullable().optional()
      })
      .passthrough()
      .nullable()
      .optional(),
    winner: z.string().nullable().optional()
  })
  .passthrough();

export const EspnTransactionItemSchema = z
  .object({
    type: z.string().nullable().optional(),
    playerId: z.number().int().nullable().optional(),
    fromTeamId: z.number().int().nullable().optional(),
    toTeamId: z.number().int().nullable().optional()
  })
  .passthrough();
export type EspnTransactionItem = z.infer<typeof EspnTransactionItemSchema>;

export const EspnTransactionSchema = z
  .object({
    id: z.union([z.string(), z.number()]).nullable().optional(),
    type: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    proposedDate: z.number().nullable().optional(),
    items: z.array(EspnTransactionItemSchema).nullable().optional()
  })
  .passthrough();
export type EspnTransaction = z.infer<typeof EspnTransactionSchema>;

export const EspnLeagueResponseSchema = z
  .object({
    id: z.number().int().nullable().optional(),
    seasonId: z.number().int().nullable().optional(),
    scoringPeriodId: z.number().int().nullable().optional(),
    teams: z.array(EspnTeamSchema).nullable().optional(),
    schedule: z.array(EspnScheduleMatchupSchema).nullable().optional(),
    draftDetail: z
      .object({
        drafted: z.boolean().nullable().optional(),
        picks: z.array(EspnDraftPickSchema).nullable().optional()
      })
      .passthrough()
      .nullable()
      .optional(),
    settings: z.record(z.string(), z.unknown()).nullable().optional(),
    status: z.record(z.string(), z.unknown()).nullable().optional(),
    transactions: z.array(EspnTransactionSchema).nullable().optional()
  })
  .passthrough();
export type EspnLeagueResponse = z.infer<typeof EspnLeagueResponseSchema>;

export const EspnNewsItemSchema = z
  .object({
    id: z.union([z.string(), z.number()]).nullable().optional(),
    headline: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    published: z.string().nullable().optional(),
    type: z.string().nullable().optional(),
    categories: z.array(z.record(z.string(), z.unknown())).nullable().optional()
  })
  .passthrough();

export const EspnNewsResponseSchema = z
  .object({
    feed: z.array(EspnNewsItemSchema).nullable().optional(),
    articles: z.array(EspnNewsItemSchema).nullable().optional()
  })
  .passthrough();
