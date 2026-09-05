"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signOut } from "@/lib/auth";
import { requireUser } from "@/lib/auth/requireUser";
import { getDb } from "@/db";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { changeUserPassword, deleteUserWithPassword } from "@/lib/users";
import {
  deleteAccountCredentials,
  describeEspnCredentialCoverage,
  listLeagues,
  setAccountCredentials
} from "@/lib/leagues";
import { verifyLeague } from "@/lib/trade/verify";
import { isMissingRelation, readOrUninitialised } from "@/db/missingRelation";

export type AccountActionResult = { ok: true } | { ok: false; error: string };

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  confirmPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH)
});

export async function changePasswordAction(formData: FormData): Promise<AccountActionResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const userId = user.id;

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword")
  });
  if (!parsed.success) {
    return { ok: false, error: "New password must be 8+ characters." };
  }
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return { ok: false, error: "New password and confirmation do not match." };
  }

  const result = await changeUserPassword(
    getDb(),
    userId,
    parsed.data.currentPassword,
    parsed.data.newPassword
  );
  if (!result.ok) {
    if (result.error === "wrong-current-password") {
      return { ok: false, error: "Current password is incorrect." };
    }
    if (result.error === "invalid-new-password") {
      return { ok: false, error: "New password must be 8+ characters." };
    }
    return { ok: false, error: "Could not update password." };
  }

  revalidatePath("/settings/account");
  return { ok: true };
}

const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  confirm: z.string().max(64)
});

export async function deleteAccountAction(formData: FormData): Promise<AccountActionResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const userId = user.id;

  const parsed = deleteAccountSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    confirm: formData.get("confirm")
  });
  if (!parsed.success) return { ok: false, error: "Missing fields." };
  // Require the user to type DELETE so a misclick on the form can't drop the
  // account — pairs with the password requirement for defense in depth.
  if (parsed.data.confirm.trim().toUpperCase() !== "DELETE") {
    return { ok: false, error: "Type DELETE to confirm." };
  }

  const result = await deleteUserWithPassword(getDb(), userId, parsed.data.currentPassword);
  if (!result.ok) {
    if (result.error === "wrong-password") return { ok: false, error: "Password is incorrect." };
    return { ok: false, error: "Could not delete account." };
  }

  // Drop the JWT cookie and bounce home. signOut returns void; the redirect
  // is what actually shows the user that the account is gone.
  await signOut({ redirect: false });
  redirect("/");
}

/**
 * Save (or rotate) the ESPN sign-in for the whole account.
 *
 * WHY THIS LIVES ON THE ACCOUNT AND NOT ON A LEAGUE. `espn_s2` and `SWID`
 * authenticate an ESPN ACCOUNT — one pair already grants access to every league
 * that account is in. Asking for them per league meant N pastes for N leagues,
 * N edits every time ESPN rotated them, and N copies of the same secret at
 * rest. Worse, it degraded silently: a user who updated three of four leagues
 * got a half-working dashboard with no visible cause.
 *
 * WHY IT IS VERIFIED BEFORE IT IS STORED. A cookie pair that does not work is
 * indistinguishable at rest from one that does, and the failure surfaces later
 * on some other page as "ESPN unavailable". So the pair is spent on a real
 * request against a league the user already has before anything is written. A
 * user with no ESPN leagues yet has nothing to test against, and that case is
 * stated rather than silently skipped.
 *
 * There is no password field here on purpose. ESPN publishes no OAuth flow, no
 * developer token, and its login is behind reCAPTCHA — a stored password could
 * not be exchanged for a session programmatically, so holding one would add a
 * far more dangerous secret and buy nothing. See docs/espn-credentials-decision.md.
 */
const espnSignInSchema = z.object({
  espnS2: z.string().min(1).max(4096),
  swid: z.string().min(1).max(128)
});

export type EspnSignInResult = { ok: true; note?: string } | { ok: false; error: string };

export async function saveEspnSignInAction(formData: FormData): Promise<EspnSignInResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };

  const parsed = espnSignInSchema.safeParse({
    espnS2: formData.get("espnS2"),
    swid: formData.get("swid")
  });
  if (!parsed.success) return { ok: false, error: "Both espn_s2 and SWID are required." };
  const credentials = { espnS2: parsed.data.espnS2.trim(), swid: parsed.data.swid.trim() };

  // WHICH LEAGUE TO TEST AGAINST MATTERS.
  //
  // A league with its own override may sit under a DIFFERENT ESPN login, and
  // testing a new account pair against that league would return 401 and reject
  // a perfectly good sign-in — refusing to save the credential because of a
  // league that was never going to use it. So the probe prefers a league this
  // pair would actually authenticate.
  const [leagues, coverage] = await Promise.all([
    listLeagues(getDb(), user.id),
    describeEspnCredentialCoverage(getDb(), user.id)
  ]);
  const wouldUseAccount = new Set(
    coverage.filter((c) => c.origin !== "league-override").map((c) => c.leagueId)
  );
  const espnLeagues = leagues.filter((l) => l.platform === "espn");
  const probe = espnLeagues.find((l) => wouldUseAccount.has(l.id));

  let note: string | undefined;
  if (probe) {
    const check = await verifyLeague({
      platform: "espn",
      externalLeagueId: probe.externalLeagueId,
      season: probe.season,
      credentials
    });
    if (!check.ok) {
      return {
        ok: false,
        error: `ESPN rejected these cookies against ${probe.label}: ${check.error}`
      };
    }
  } else if (espnLeagues.length > 0) {
    // Every ESPN league has its own override, so nothing here would use this
    // pair yet. Saving it is still right — it is what the next league added
    // will use — but claiming it was verified would be a lie.
    note =
      "Saved. Not tested: every ESPN league you have uses its own cookies, so nothing needed this pair yet.";
  } else {
    note = "Saved, but not yet tested — add an ESPN league and it will be used on the first refresh.";
  }

  // The WRITE is not wrapped in readOrUninitialised: a save that silently did
  // nothing would be the worst outcome on this page, because the user would
  // believe their sign-in is stored. A missing table is reported as the
  // deployment fault it is, in terms an operator can act on.
  try {
    await setAccountCredentials(getDb(), user.id, credentials);
  } catch (err) {
    if (isMissingRelation(err)) {
      return {
        ok: false,
        error:
          "Nothing was saved: this deployment's database has not had its schema applied. Your cookies are still valid — apply the schema (README, \"Applying the Postgres schema\") and try again."
      };
    }
    throw err;
  }
  revalidatePath("/settings/account");
  revalidatePath("/settings/leagues");
  return note ? { ok: true, note } : { ok: true };
}

/**
 * Remove the account ESPN sign-in.
 *
 * Leagues are NOT deleted with it. A removed sign-in makes them unauthenticated,
 * which every surface already reports as unavailable with a stated reason — and
 * that is recoverable by pasting a new pair, whereas deleting the leagues would
 * discard their confirmed keeper rules too.
 */
export async function removeEspnSignInAction(): Promise<EspnSignInResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  // A delete against a table that does not exist has already achieved what it
  // was asked to do, so this one IS safe to treat as success.
  await readOrUninitialised(async () => deleteAccountCredentials(getDb(), user.id), undefined);
  revalidatePath("/settings/account");
  revalidatePath("/settings/leagues");
  return { ok: true };
}
