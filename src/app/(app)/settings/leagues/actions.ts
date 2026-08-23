"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { updateLeagueSettingsForUser } from "@/lib/leagues";
import { KeeperCostRuleSchema } from "@/lib/trade/format";
import { getDb } from "@/db";
import { createLeague, deleteLeagueForUser, findUserLeagueByExternal, getLeagueForUser } from "@/lib/leagues";
import { setActiveLeagueCookie } from "@/lib/activeLeague";
import { verifyLeague } from "@/lib/trade/verify";
import type { LeagueFormat } from "@/lib/trade/format";

const addLeagueSchema = z.object({
  platform: z.enum(["sleeper", "espn"]),
  externalLeagueId: z.string().min(1).max(64),
  season: z.coerce.number().int().min(2010).max(2099),
  label: z.string().min(1).max(80),
  espnS2: z.string().optional(),
  swid: z.string().optional(),
  sleeperUsername: z.string().max(50).optional()
});

export type AddLeagueResult = { ok: true; leagueId: string } | { ok: false; error: string };

export async function addLeague(formData: FormData): Promise<AddLeagueResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const userId = user.id;

  const parsed = addLeagueSchema.safeParse({
    platform: formData.get("platform"),
    externalLeagueId: formData.get("externalLeagueId"),
    season: formData.get("season"),
    label: formData.get("label"),
    espnS2: formData.get("espnS2") ?? undefined,
    swid: formData.get("swid") ?? undefined,
    sleeperUsername: formData.get("sleeperUsername") ?? undefined
  });
  if (!parsed.success) return { ok: false, error: "Invalid form input" };

  const { platform, externalLeagueId, season, label, espnS2, swid, sleeperUsername } = parsed.data;
  if (platform === "espn" && (!espnS2 || !swid)) {
    return { ok: false, error: "ESPN leagues require both espn_s2 and SWID cookies" };
  }

  // Friendly duplicate pre-check — fail fast with a clear message before the
  // (network) verification, rather than letting createLeague's guard surface
  // as the generic "could not save" below. createLeague still enforces it.
  if (await findUserLeagueByExternal(getDb(), userId, platform, externalLeagueId, season)) {
    return { ok: false, error: "You've already added this league for that season." };
  }

  // Both Sleeper and ESPN leagues are verified at add-time. Sleeper uses the
  // public API; ESPN fetches mSettings with the user's espn_s2 + SWID cookies.
  // The detected format is persisted for both platforms.
  const verification = await verifyLeague({
    platform,
    externalLeagueId,
    season,
    credentials: platform === "espn" ? { espnS2: espnS2!, swid: swid! } : undefined
  });
  if (!verification.ok) {
    return { ok: false, error: verification.error };
  }
  const detectedSettings: LeagueFormat = verification.format;

  try {
    const league = await createLeague(getDb(), {
      userId,
      platform,
      externalLeagueId,
      season,
      label,
      credentials: platform === "espn" ? { espnS2: espnS2!, swid: swid! } : undefined,
      settings: detectedSettings,
      sleeperUsername: platform === "sleeper" ? (sleeperUsername || undefined) : undefined
    });
    revalidatePath("/settings/leagues");
    return { ok: true, leagueId: league.id };
  } catch {
    // Never surface a raw DB/driver error to the browser — it can leak internal
    // detail (table/constraint names, connection failures). Return a fixed,
    // user-actionable message. Validation + verification above already handle
    // the cases the user can fix; anything reaching here is an internal fault.
    return { ok: false, error: "Could not save this league. Please try again." };
  }
}

/**
 * Persist the league rules an owner must confirm because no platform publishes
 * them (audit F-010).
 *
 * Verified against a real ESPN keeper league across four seasons: `draftSettings`
 * carries keeperCount and keeperOrderType but NO cost field, the 2025 draft has
 * zero keeper picks to infer from, and the keeper rule only began in 2026. So
 * the cost is a league convention that exists nowhere in the data. Rather than
 * guess it — a keeper decision is irreversible for the season — the app asks
 * once and stores the answer.
 *
 * Only owner-confirmable fields are accepted. Scoring, roster slots and team
 * count stay DETECTED, so the app can never report settings that disagree with
 * the league itself.
 */
const confirmSettingsSchema = z.object({
  leagueId: z.string().min(1),
  keeperCostRule: KeeperCostRuleSchema,
  keeperCostRound: z.coerce.number().int().positive().max(30).nullable().catch(null),
  draftSlot: z.coerce.number().int().positive().max(32).nullable().catch(null)
});

export async function confirmLeagueSettings(formData: FormData): Promise<AddLeagueResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const raw = {
    leagueId: formData.get("leagueId"),
    keeperCostRule: formData.get("keeperCostRule"),
    keeperCostRound: formData.get("keeperCostRound") || null,
    draftSlot: formData.get("draftSlot") || null
  };
  const parsed = confirmSettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Invalid settings input" };

  const { leagueId, keeperCostRule, keeperCostRound, draftSlot } = parsed.data;
  // A fixed-round rule without a round is not a confirmation, it is a gap.
  if (keeperCostRule === "fixed-round" && !keeperCostRound) {
    return { ok: false, error: "Choose which round a keeper costs." };
  }

  const updated = await updateLeagueSettingsForUser(getDb(), user.id, leagueId, {
    keeperCostRule,
    keeperCostRound: keeperCostRule === "fixed-round" ? keeperCostRound : null,
    draftSlot
  });
  if (!updated) return { ok: false, error: "League not found" };

  revalidatePath("/settings/leagues");
  revalidatePath("/draft");
  return { ok: true, leagueId };
}

export async function removeLeague(leagueId: string): Promise<AddLeagueResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const userId = user.id;
  const deleted = await deleteLeagueForUser(getDb(), userId, leagueId);
  if (!deleted) return { ok: false, error: "not found" };
  revalidatePath("/settings/leagues");
  return { ok: true, leagueId };
}

/**
 * Set the user's active league (Feature C — multi-league switcher). Validates
 * ownership via getLeagueForUser before writing the cookie — defense in depth
 * even though getActiveLeagueId re-validates on every read.
 */
export async function setActiveLeagueAction(leagueId: string): Promise<AddLeagueResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const userId = user.id;
  const league = await getLeagueForUser(getDb(), userId, leagueId);
  if (!league) return { ok: false, error: "not found" };
  await setActiveLeagueCookie(leagueId);
  revalidatePath("/");
  return { ok: true, leagueId };
}
