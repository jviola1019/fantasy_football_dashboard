import { and, asc, eq, inArray } from "drizzle-orm";
import { decrypt, encrypt, getCredentialKey } from "./crypto";
import { schema } from "../db";
import { readOrUninitialised } from "../db/missingRelation";
import { DEFAULT_FORMAT, type LeagueFormat } from "./trade/format";

export type LeaguePlatform = "sleeper" | "espn";

export interface CreateLeagueInput {
  userId: string;
  platform: LeaguePlatform;
  externalLeagueId: string;
  season: number;
  label: string;
  /** ESPN private leagues; required for espn, optional/ignored otherwise. */
  credentials?: { espnS2: string; swid: string };
  /** Detected league format from verification; persisted as JSON. */
  settings?: LeagueFormat;
  /** Sleeper-only: the user's Sleeper username used to identify their roster. */
  sleeperUsername?: string;
}

export interface DecryptedCredentials {
  espnS2: string;
  swid: string;
}

export interface LeagueRecord {
  id: string;
  userId: string;
  platform: LeaguePlatform;
  externalLeagueId: string;
  season: number;
  label: string;
  settings: LeagueFormat | null;
  /** Sleeper-only: stored so we can resolve the user's roster_id at query time. */
  sleeperUsername: string | null;
  createdAt: Date;
}

type Db = ReturnType<typeof import("../db").getDb>;

/**
 * Find a user's existing league by its external identity (platform +
 * externalLeagueId + season). Scoped to the user so the same Sleeper/ESPN id
 * under two accounts is never treated as the same league. Returns null if none.
 */
export async function findUserLeagueByExternal(
  db: Db,
  userId: string,
  platform: LeaguePlatform,
  externalLeagueId: string,
  season: number
): Promise<LeagueRecord | null> {
  const rows = await db
    .select()
    .from(schema.leagues)
    .where(
      and(
        eq(schema.leagues.userId, userId),
        eq(schema.leagues.platform, platform),
        eq(schema.leagues.externalLeagueId, externalLeagueId),
        eq(schema.leagues.season, season)
      )
    )
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

export async function createLeague(db: Db, input: CreateLeagueInput): Promise<LeagueRecord> {
  // THE INVARIANT IS "AUTHENTICATABLE", NOT "CARRIES ITS OWN COPY".
  //
  // This used to demand `input.credentials` for every ESPN league, which made
  // the account-level pair unreachable from the only path that creates leagues:
  // a user who had saved their ESPN sign-in was still forced to paste the same
  // two cookies again for the second league, and the third. The rule that
  // actually protects the user is that no ESPN league is created which cannot
  // authenticate — so ask resolution, not the argument.
  if (input.platform === "espn" && !input.credentials) {
    // An uninitialised table reads as "no account pair", which is the truth
    // from the caller's side: there is nothing to authenticate with, and the
    // existing error tells the user to supply cookies.
    const account = await readOrUninitialised(() => getAccountCredentialAge(db, input.userId), null);
    if (!account) {
      throw new Error("ESPN private leagues require espn_s2 + SWID cookies");
    }
  }
  // Duplicate guard: a user re-adding the same league for the same season must
  // not create a second (often hollow) row. Per-user + per-season so the same
  // league id under another account, or the same id for a new season, is fine.
  const existing = await findUserLeagueByExternal(
    db,
    input.userId,
    input.platform,
    input.externalLeagueId,
    input.season
  );
  if (existing) {
    throw new Error("duplicate league: already added for this user and season");
  }
  // Audit 2026-08-22, P1-6: this writes TWO rows and had no transaction, so a
  // failure between them left an ESPN league with no credentials. That league
  // could never refresh, reported a misleading "credentials missing" error, and
  // the duplicate guard above then BLOCKED the user from re-adding it — a
  // permanently bricked row created by a transient failure.
  //
  // A real transaction is not available here: `Db` is typed for better-sqlite3,
  // whose drizzle transaction callback must be synchronous, while the
  // production Postgres driver requires an async one. The two are not
  // reconcilable behind this shared type, and getting it wrong is a runtime
  // failure on exactly one driver — the one that matters.
  //
  // So the window is closed from both ends instead:
  //   1. Encryption happens BEFORE any row is written. `getCredentialKey()`
  //      throwing on a missing or malformed key, and `encrypt` itself, are the
  //      likely failures, and now neither can leave anything behind.
  //   2. If the credentials INSERT still fails, the league row is deleted and
  //      the original error is rethrown, so the user can simply try again.
  const sealed = input.credentials
    ? (() => {
        const key = getCredentialKey();
        return encrypt(JSON.stringify(input.credentials), key);
      })()
    : null;

  const inserted = await db
    .insert(schema.leagues)
    .values({
      userId: input.userId,
      platform: input.platform,
      externalLeagueId: input.externalLeagueId,
      season: input.season,
      label: input.label,
      settings: input.settings ? JSON.stringify(input.settings) : null,
      sleeperUsername: input.sleeperUsername ?? null
    })
    .returning();
  const row = inserted[0]!;

  if (sealed) {
    try {
      await db.insert(schema.leagueCredentials).values({
        leagueId: row.id,
        iv: sealed.iv,
        authTag: sealed.authTag,
        ciphertext: sealed.ciphertext
      });
    } catch (err) {
      // Compensate, then report. If the compensation ALSO fails the user must
      // hear about it, because the row is now the bricked state described
      // above and silence would leave them re-trying into a duplicate error.
      let rolledBack = false;
      try {
        rolledBack = await deleteLeagueForUser(db, input.userId, row.id);
      } catch {
        rolledBack = false;
      }
      const reason = err instanceof Error ? err.message : String(err);
      throw new Error(
        rolledBack
          ? `Could not store league credentials (${reason}). The league was not added; please try again.`
          : `Could not store league credentials (${reason}), and the partially-created league could not be removed. League id ${row.id} has no credentials and must be deleted before re-adding.`
      );
    }
  }

  return toRecord(row);
}

/**
 * A user's leagues, oldest first.
 *
 * The ORDER BY is not cosmetic. `leagues[0]` is the DEFAULT ACTIVE LEAGUE when
 * no selection cookie is present (`activeLeague.ts`), so the order of this
 * result decides whose roster, projections, trade prices and keeper costs a
 * returning user sees. Without it, SQLite happened to return insertion order
 * and Postgres was free to return anything — and on Postgres an UPDATE
 * physically relocates a row, so merely editing one league's settings could
 * silently change which league the app opened on. Audit 2026-08-22, P1-1.
 *
 * `createdAt` then `id` — createdAt alone is not a total order, because two
 * leagues added in the same millisecond would tie and reintroduce the
 * non-determinism this exists to remove.
 */
export async function listLeagues(db: Db, userId: string): Promise<LeagueRecord[]> {
  const rows = await db
    .select()
    .from(schema.leagues)
    .where(eq(schema.leagues.userId, userId))
    .orderBy(asc(schema.leagues.createdAt), asc(schema.leagues.id));
  return rows.map(toRecord);
}

export async function getLeagueForUser(db: Db, userId: string, leagueId: string): Promise<LeagueRecord | null> {
  const rows = await db
    .select()
    .from(schema.leagues)
    .where(and(eq(schema.leagues.userId, userId), eq(schema.leagues.id, leagueId)))
    .limit(1);
  return rows[0] ? toRecord(rows[0]) : null;
}

/**
 * Merge owner-confirmed settings into a league's stored format.
 *
 * Scoped by userId as well as leagueId so one account can never edit another's
 * league — the same ownership rule every other league mutation follows.
 *
 * Only the fields an owner can legitimately confirm are accepted. Everything
 * else (scoring, roster slots, team count) is DETECTED from the platform and
 * must not be hand-editable, or the app would start reporting settings that
 * disagree with the league itself.
 */
export async function updateLeagueSettingsForUser(
  db: Db,
  userId: string,
  leagueId: string,
  patch: Partial<Pick<LeagueFormat, "keeperCostRule" | "keeperCostRound" | "draftSlot">>
): Promise<LeagueRecord | null> {
  const existing = await getLeagueForUser(db, userId, leagueId);
  if (!existing) return null;
  const merged: LeagueFormat = { ...(existing.settings ?? DEFAULT_FORMAT), ...patch };
  const updated = await db
    .update(schema.leagues)
    .set({ settings: JSON.stringify(merged) })
    .where(and(eq(schema.leagues.id, leagueId), eq(schema.leagues.userId, userId)))
    .returning();
  const row = updated[0];
  return row ? toRecord(row) : null;
}

/**
 * Update the Sleeper username used to identify WHICH TEAM is yours.
 *
 * Audit 2026-08-31 (D-D). This was write-once at league-add time. When it is
 * missing or does not match, `resolveSleeperRosterId` returns null and
 * `fetchLive.ts:334` substitutes `sleeperRosters[0]` — a stranger's team. The
 * substitution is declared, but the only remedy was to delete the league and
 * re-add it, which throws away its keeper settings too.
 *
 * Kept separate from `updateLeagueSettingsForUser` on purpose. That function
 * guards platform-DETECTED format (scoring, roster slots, team count), which
 * must not be hand-editable or the app starts reporting settings the league
 * itself disagrees with. This is the opposite kind of field: user-supplied
 * identity that the platform cannot tell us, and that only the owner can
 * confirm. Merging the two would blur a distinction the comment above relies on.
 *
 * An empty string clears it, which is a legitimate choice — the app then says
 * plainly that it is showing the first team rather than pretending otherwise.
 */
export async function updateLeagueIdentityForUser(
  db: Db,
  userId: string,
  leagueId: string,
  sleeperUsername: string | null
): Promise<LeagueRecord | null> {
  const existing = await getLeagueForUser(db, userId, leagueId);
  if (!existing) return null;
  const trimmed = sleeperUsername?.trim() ?? "";
  const updated = await db
    .update(schema.leagues)
    .set({ sleeperUsername: trimmed.length > 0 ? trimmed : null })
    .where(and(eq(schema.leagues.id, leagueId), eq(schema.leagues.userId, userId)))
    .returning();
  const row = updated[0];
  return row ? toRecord(row) : null;
}

export async function deleteLeagueForUser(db: Db, userId: string, leagueId: string): Promise<boolean> {
  const result = await db
    .delete(schema.leagues)
    .where(and(eq(schema.leagues.userId, userId), eq(schema.leagues.id, leagueId)))
    .returning({ id: schema.leagues.id });
  return result.length > 0;
}

/**
 * The per-league override pair, if this league has one.
 *
 * Reads through the shared `open()` rather than unsealing inline. It had its own
 * copy of the decrypt-and-parse, which is one of two implementations of the same
 * operation — the shape that gave `fingerprintRows` two answers and that
 * `csv.ts` and `correlation.ts` were extracted to end. A second unsealing path
 * is worse than most duplicates, because the two can disagree about a secret
 * and the disagreement surfaces as an unexplained authentication failure.
 *
 * The app reaches credentials through `resolveEspnCredentials`; this stays as
 * the direct accessor for the override row itself, which is what the tests
 * assert on when they check that nothing was stored per league.
 */
export async function getLeagueCredentials(db: Db, leagueId: string): Promise<DecryptedCredentials | null> {
  const rows = await db
    .select()
    .from(schema.leagueCredentials)
    .where(eq(schema.leagueCredentials.leagueId, leagueId))
    .limit(1);
  return rows[0] ? open(rows[0]) : null;
}

/**
 * Where a set of ESPN cookies came from. Returned with them so nothing has to
 * guess, and so the UI can say "account sign-in" rather than implying the
 * league holds its own secret.
 */
export type CredentialOrigin = "league-override" | "account";

export interface ResolvedCredentials extends DecryptedCredentials {
  origin: CredentialOrigin;
  /** When the pair was last written. ESPN cookies expire; age is the only hint. */
  rotatedAt: Date;
}

/** Decrypt one sealed row. Shared so the two lookups cannot drift apart. */
function open(row: { iv: unknown; authTag: unknown; ciphertext: unknown }): DecryptedCredentials {
  const plaintext = decrypt(
    {
      iv: toBuffer(row.iv as Buffer),
      authTag: toBuffer(row.authTag as Buffer),
      ciphertext: toBuffer(row.ciphertext as Buffer)
    },
    getCredentialKey()
  );
  return JSON.parse(plaintext) as DecryptedCredentials;
}

/**
 * The ESPN cookies to use for one league: league override, then account, then none.
 *
 * The ORDER IS THE CONTRACT and it is deliberate. `espn_s2`/`SWID` authenticate
 * an ESPN account rather than a league, so the account pair is the normal case
 * and one update fixes every league. A per-league row exists only for somebody
 * whose leagues sit under two different ESPN logins, and it must win where it
 * exists — otherwise adding a second login would silently break the first.
 *
 * Ambiguity here would be its own defect: "which secret did that request use"
 * has to have one answer, which is why `origin` travels with the result.
 *
 * See docs/espn-credentials-decision.md.
 */
export async function resolveEspnCredentials(
  db: Db,
  userId: string,
  leagueId: string
): Promise<ResolvedCredentials | null> {
  const override = await db
    .select()
    .from(schema.leagueCredentials)
    .where(eq(schema.leagueCredentials.leagueId, leagueId))
    .limit(1);
  if (override[0]) {
    return { ...open(override[0]), origin: "league-override", rotatedAt: override[0].rotatedAt };
  }
  // A missing table degrades to "no account pair", which the caller already
  // reports honestly as missing credentials. It must not throw: this runs on
  // EVERY request for an ESPN league, so an uninitialised database would take
  // down every route rather than the one feature that needs the table.
  const account = await readOrUninitialised(() => getAccountCredentials(db, userId), null);
  if (account) return { ...account, origin: "account" };
  return null;
}

/**
 * The account pair on its own, for the paths that have a user but not yet a
 * league — verifying a newly pasted pair, and adding the first ESPN league.
 *
 * Kept as the single reader of that row so `resolveEspnCredentials` and the
 * add-league path cannot drift into disagreeing about what "the account
 * credentials" are.
 */
export async function getAccountCredentials(
  db: Db,
  userId: string
): Promise<(DecryptedCredentials & { rotatedAt: Date }) | null> {
  const rows = await db
    .select()
    .from(schema.accountCredentials)
    .where(eq(schema.accountCredentials.userId, userId))
    .limit(1);
  return rows[0] ? { ...open(rows[0]), rotatedAt: rows[0].rotatedAt } : null;
}

/**
 * Write (or replace) the account-level ESPN cookies.
 *
 * One row per user, so a rotation is one edit no matter how many ESPN leagues
 * exist. Re-sealing rather than updating in place keeps a fresh IV, which
 * AES-GCM requires: reusing an IV under the same key is what breaks GCM.
 */
export async function setAccountCredentials(
  db: Db,
  userId: string,
  credentials: DecryptedCredentials
): Promise<void> {
  const sealed = encrypt(JSON.stringify(credentials), getCredentialKey());
  await db.delete(schema.accountCredentials).where(eq(schema.accountCredentials.userId, userId));
  await db.insert(schema.accountCredentials).values({
    userId,
    provider: "espn",
    iv: sealed.iv,
    authTag: sealed.authTag,
    ciphertext: sealed.ciphertext,
    rotatedAt: new Date()
  });
}

/** Age of the stored account pair, or null when there is none. */
export async function getAccountCredentialAge(
  db: Db,
  userId: string
): Promise<{ rotatedAt: Date } | null> {
  const rows = await db
    .select({ rotatedAt: schema.accountCredentials.rotatedAt })
    .from(schema.accountCredentials)
    .where(eq(schema.accountCredentials.userId, userId))
    .limit(1);
  return rows[0] ? { rotatedAt: rows[0].rotatedAt } : null;
}

export async function deleteAccountCredentials(db: Db, userId: string): Promise<void> {
  await db.delete(schema.accountCredentials).where(eq(schema.accountCredentials.userId, userId));
}

/** One ESPN league and which credential would authenticate it. */
export interface EspnCredentialCoverage {
  leagueId: string;
  label: string;
  /** null means this league currently has nothing to authenticate with. */
  origin: CredentialOrigin | null;
}

/**
 * Which credential each of the user's ESPN leagues would use, WITHOUT decrypting
 * any of them.
 *
 * Existence is the whole question here, so this checks for rows and stops.
 * Decrypting to render a settings page would put plaintext cookies in server
 * memory for a screen that must never display them, which is the sort of
 * convenience that turns into an incident.
 *
 * This is what lets "remove my ESPN sign-in" state its actual consequence —
 * the number of leagues that stop working — instead of asking the user to
 * confirm something whose blast radius only the database knows.
 */
export async function describeEspnCredentialCoverage(
  db: Db,
  userId: string
): Promise<EspnCredentialCoverage[]> {
  const leagues = await db
    .select({ id: schema.leagues.id, label: schema.leagues.label })
    .from(schema.leagues)
    .where(and(eq(schema.leagues.userId, userId), eq(schema.leagues.platform, "espn")));
  if (leagues.length === 0) return [];

  // Scoped to THIS user's league ids. Selecting the whole table and filtering in
  // memory gave the right answer and read every other user's rows to do it — a
  // full scan that grows with the service, to answer a question about one
  // account.
  const overrides = await db
    .select({ leagueId: schema.leagueCredentials.leagueId })
    .from(schema.leagueCredentials)
    .where(inArray(schema.leagueCredentials.leagueId, leagues.map((l) => l.id)));
  const overridden = new Set(overrides.map((r) => r.leagueId));
  const hasAccount =
    (await readOrUninitialised(() => getAccountCredentialAge(db, userId), null)) !== null;

  return leagues.map((l) => ({
    leagueId: l.id,
    label: l.label,
    origin: overridden.has(l.id) ? "league-override" : hasAccount ? "account" : null
  }));
}

function toRecord(row: typeof schema.leagues.$inferSelect): LeagueRecord {
  return {
    id: row.id,
    userId: row.userId,
    platform: row.platform as LeaguePlatform,
    externalLeagueId: row.externalLeagueId,
    season: row.season,
    label: row.label,
    settings: parseSettings(row.settings),
    sleeperUsername: row.sleeperUsername ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt : new Date(row.createdAt)
  };
}

// `settings` is stored as TEXT on SQLite (a JSON-encoded string) and as JSONB
// on Postgres (postgres-js auto-decodes JSONB into a JS object). Calling
// JSON.parse on an already-decoded object would coerce it to "[object Object]"
// and throw, which is the production crash this branch fixes.
function parseSettings(raw: unknown): LeagueFormat | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "string") {
    if (raw.length === 0) return null;
    return JSON.parse(raw) as LeagueFormat;
  }
  if (typeof raw === "object") return raw as LeagueFormat;
  return null;
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "base64");
  throw new Error("invalid encrypted column type");
}
