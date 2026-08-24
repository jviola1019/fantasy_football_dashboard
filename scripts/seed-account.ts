/**
 * Create or reset an account from the ENVIRONMENT — never from source.
 *
 * WHY THIS EXISTS.
 *
 * "Give me a working account" is a reasonable request with an unreasonable
 * obvious implementation: seed a known email and password into the repository.
 * That commits a live credential, and `check:secrets` scans 325 tracked files
 * to stop exactly that. A password in git history is a password you cannot
 * un-publish; the burned-secret deny-list in `docSecrets.ts` exists because
 * this repository has learned that once already.
 *
 * So the credential comes from the environment at run time and is never
 * written down:
 *
 *   SEED_EMAIL=you@example.com SEED_PASSWORD='...' npm run seed:account
 *
 * Against production, point DATABASE_URL at the production database in the same
 * command. Nothing here is baked in.
 *
 * IDEMPOTENT. Run it on an existing account and it RESETS that account's
 * password and revokes every outstanding session, which is the honest
 * behaviour for a tool whose job is "make sure I can get in":
 *   - resetting silently would leave old sessions alive, so a leaked token
 *     would survive the reset;
 *   - refusing outright would make it useless for the case people actually hit,
 *     which is "I do not remember the password".
 */
import { getDb, schema } from "../src/db";
import { createUserWithPassword } from "../src/lib/users";
import { revokeAllSessions } from "../src/lib/auth/session";
import { hashPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "../src/lib/passwords";
import { eq } from "drizzle-orm";

function fail(message: string): never {
  console.error(`seed-account: ${message}`);
  process.exit(2);
}

async function main(): Promise<void> {
  const email = (process.env.SEED_EMAIL ?? "").trim().toLowerCase();
  const password = process.env.SEED_PASSWORD ?? "";
  const name = process.env.SEED_NAME?.trim() || undefined;

  if (!email || !email.includes("@")) {
    fail("SEED_EMAIL must be a real email address. Nothing is defaulted — a default here would be a credential in source.");
  }
  if (password.length < MIN_PASSWORD_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
    fail(`SEED_PASSWORD must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters. It is read from the environment and never printed.`);
  }
  if (!process.env.DATABASE_URL) {
    // Silently seeding a local SQLite file while the operator believes they are
    // provisioning production is the kind of quiet mismatch this repo keeps
    // finding. Make them say which database.
    fail("DATABASE_URL is not set. Set it explicitly so it is clear WHICH database is being written to.");
  }

  const db = getDb();
  const existing = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  if (existing[0]) {
    // Hash with the CURRENT profile, the same path registration uses, so a
    // seeded account is not stored differently from a registered one.
    const passwordHash = await hashPassword(password);
    await db.update(schema.users).set({ passwordHash }).where(eq(schema.users.id, existing[0].id));
    const version = await revokeAllSessions(existing[0].id, db);
    // The email is echoed; the password never is.
    console.log(`seed-account: reset the password for ${email}`);
    console.log(`seed-account: revoked every outstanding session (sessionVersion is now ${version})`);
    console.log("seed-account: sign in at /login with the password you just supplied.");
    return;
  }

  const user = await createUserWithPassword(db, { email, password, name });
  console.log(`seed-account: created ${email} (id ${user.id})`);
  console.log("seed-account: sign in at /login with the password you just supplied.");
}

main().catch((err) => {
  // Never let a driver error print a connection string.
  const message = err instanceof Error ? err.message : String(err);
  console.error("seed-account failed:", message.replace(/postgres(?:ql)?:\/\/[^\s'"`]+/gi, "postgres://[REDACTED]"));
  process.exitCode = 1;
});
