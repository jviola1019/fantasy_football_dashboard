"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/requireUser";
import { updateLeagueIdentityForUser, updateLeagueSettingsForUser } from "@/lib/leagues";
import { KeeperCostRuleSchema } from "@/lib/trade/format";
import { getDb } from "@/db";
import {
  createLeague,
  deleteLeagueForUser,
  findUserLeagueByExternal,
  getAccountCredentials,
  getLeagueForUser,
  setAccountCredentials
} from "@/lib/leagues";
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
  // "league" only when the user ticked "this league is under a different ESPN
  // login". Anything else means the pasted pair is their account sign-in.
  credentialScope: z.enum(["account", "league"]).catch("account"),
  sleeperUsername: z.string().max(50).optional()
});

export type AddLeagueResult =
  | {
      ok: true;
      leagueId: string;
      /**
       * Something the user should know happened, that is not an error.
       *
       * Today this is only the season correction. It is a NOTE rather than a
       * silent write because overriding what somebody typed without telling
       * them is its own kind of dishonesty, even when the override is right.
       */
      note?: string;
    }
  | { ok: false; error: string };

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
    credentialScope: formData.get("credentialScope") ?? "account",
    sleeperUsername: formData.get("sleeperUsername") ?? undefined
  });
  if (!parsed.success) return { ok: false, error: "Invalid form input" };

  const { platform, externalLeagueId, season, label, espnS2, swid, sleeperUsername, credentialScope } =
    parsed.data;

  // ESPN COOKIES ARE OPTIONAL HERE WHEN THE ACCOUNT ALREADY HAS A PAIR.
  //
  // `espn_s2`/`SWID` authenticate an ESPN account, not a league, so demanding
  // them again per league asked the user to re-paste a secret the app already
  // holds — and then stored a second copy of it. A pair typed here is treated
  // as a deliberate per-league OVERRIDE, for somebody whose leagues sit under
  // two different ESPN logins; anything else falls back to the account.
  //
  // `override` is what gets persisted with the league. `verifyCredentials` is
  // what gets spent on the add-time check. They differ exactly when the account
  // pair is doing the work, which is the normal case.
  const typed = espnS2 && swid ? { espnS2, swid } : undefined;
  // Typed cookies are the ACCOUNT sign-in unless the user said otherwise. That
  // is what makes the first ESPN league a one-time paste instead of the first
  // of N: without it, adding four leagues stored four copies of one secret.
  const override = typed && credentialScope === "league" ? typed : undefined;
  const existingAccount =
    platform === "espn" ? await getAccountCredentials(getDb(), userId) : null;

  let verifyCredentials = typed;
  if (platform === "espn" && !typed) {
    if (!existingAccount) {
      return {
        ok: false,
        error:
          "ESPN leagues need an ESPN sign-in. Save espn_s2 and SWID once in Settings → Account, or paste them here."
      };
    }
    verifyCredentials = { espnS2: existingAccount.espnS2, swid: existingAccount.swid };
  }

  // Friendly duplicate pre-check — fail fast with a clear message before the
  // (network) verification, rather than letting createLeague's guard surface
  // as the generic "could not save" below. createLeague still enforces it.
  // Repeated below against the RESOLVED season, which is the one that is stored.
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
    credentials: platform === "espn" ? verifyCredentials : undefined
  });
  if (!verification.ok) {
    return { ok: false, error: verification.error };
  }
  const detectedSettings: LeagueFormat = verification.format;

  // THE PLATFORM'S SEASON WINS, AND THE USER IS TOLD.
  //
  // A Sleeper league id belongs to exactly one season — a renewal gets a new id,
  // chained by `previous_league_id` — so the season box on this form asks the
  // user to retype something the payload already states. Storing the typed value
  // let a 2026 league be filed as 2019: every season-keyed lookup (weekly
  // projections, season stats snapshots, the season mirror) would then look for
  // a season the league is not in, and the SAME league could be added once per
  // season typed, each row looking like a different league.
  //
  // `resolvedSeason` is null only when the platform declared nothing, and then
  // the typed value is all there is.
  const resolvedSeason = verification.resolvedSeason ?? season;
  const seasonNote =
    resolvedSeason !== season
      ? `This league is ${platform === "sleeper" ? "Sleeper" : "ESPN"}'s ${resolvedSeason} season, not ${season} — saved as ${resolvedSeason}.`
      : undefined;

  // Re-check duplicates against the season actually being written. Without
  // this, adding the same league under a second typed season passes the check
  // above and then trips the unique constraint, surfacing as the generic
  // "Could not save this league" — an internal-fault message for a mistake the
  // user can understand and fix.
  if (
    resolvedSeason !== season &&
    (await findUserLeagueByExternal(getDb(), userId, platform, externalLeagueId, resolvedSeason))
  ) {
    return {
      ok: false,
      error: `You've already added this league. It is the ${resolvedSeason} season, whatever season is typed here.`
    };
  }

  // Adopt the pasted pair as the account sign-in — but only when there is not
  // one already.
  //
  // ADOPT, NEVER REPLACE. The form cannot send cookies with account scope once a
  // pair is saved (the fields collapse into the override tick), so a request
  // that does is hand-crafted, and silently swapping an account-wide secret from
  // a league form is not something this path should be able to do. Replacing has
  // its own home on /settings/account, where it is verified and where the user
  // is told what it covers.
  //
  // Written after verification passed and BEFORE createLeague, whose ESPN guard
  // asks whether the account can authenticate. A failure after this point leaves
  // a verified sign-in and no league — recoverable by retrying, and not a secret
  // the user did not intend to store.
  if (platform === "espn" && typed && credentialScope === "account" && !existingAccount) {
    await setAccountCredentials(getDb(), userId, typed);
  }

  try {
    const league = await createLeague(getDb(), {
      userId,
      platform,
      externalLeagueId,
      season: resolvedSeason,
      label,
      // Only a genuine override is stored per league. When the account pair
      // authenticated this add, nothing is written here — one secret, one copy.
      credentials: platform === "espn" ? override : undefined,
      settings: detectedSettings,
      sleeperUsername: platform === "sleeper" ? (sleeperUsername || undefined) : undefined
    });
    revalidatePath("/settings/leagues");
    revalidatePath("/settings/account");
    return seasonNote ? { ok: true, leagueId: league.id, note: seasonNote } : { ok: true, leagueId: league.id };
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

const identitySchema = z.object({
  leagueId: z.string().min(1),
  // Empty is allowed and means "clear it" — the app then states plainly that it
  // is showing the first team, which is honest. Sleeper usernames are short.
  sleeperUsername: z.string().max(64).nullable().catch(null)
});

/**
 * Set which Sleeper account is yours, so the app scores YOUR team.
 *
 * Audit 2026-08-31 (D-D). Without this the username was write-once at add time,
 * and a missing or mistyped one silently substituted the first roster in the
 * league — someone else's drafted team driving the roster view, the simulation,
 * Roster Health and Next Best Actions. The only remedy was deleting the league
 * and re-adding it, which discarded its keeper settings as well.
 */
export async function updateLeagueIdentity(formData: FormData): Promise<AddLeagueResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const parsed = identitySchema.safeParse({
    leagueId: formData.get("leagueId"),
    sleeperUsername: formData.get("sleeperUsername")
  });
  if (!parsed.success) return { ok: false, error: "Invalid username input" };

  const updated = await updateLeagueIdentityForUser(
    getDb(),
    user.id,
    parsed.data.leagueId,
    parsed.data.sleeperUsername
  );
  if (!updated) return { ok: false, error: "League not found" };

  // Every surface that renders a roster is downstream of which team is "yours".
  revalidatePath("/settings/leagues");
  revalidatePath("/dashboard");
  revalidatePath("/players");
  revalidatePath("/waivers");
  return { ok: true, leagueId: parsed.data.leagueId };
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
