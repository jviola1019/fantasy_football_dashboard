/**
 * Re-encrypt stored league credentials under a NEW `CREDENTIAL_ENCRYPTION_KEY`.
 *
 * WHY THIS EXISTS
 *
 * `src/lib/crypto.ts` seals credentials with a single AES-256-GCM key. There is
 * no key id in the payload and no dual-read path, so swapping the env var makes
 * every stored ESPN credential permanently undecryptable. Until this script
 * existed, the honest advice was "that key can never be rotated" — which is a
 * bad position to be in if it is ever exposed.
 *
 * This closes that gap: decrypt with the old key, re-seal with the new one, and
 * only then swap the env var.
 *
 * SAFETY, in the order it matters
 *
 *  1. DRY RUN BY DEFAULT. It reports what it would do and writes nothing unless
 *     `--apply` is passed. A production database mutation should never be the
 *     default behaviour of a script you ran to see what it does.
 *  2. ROUND-TRIP VERIFIED BEFORE WRITING. Every row is re-encrypted and then
 *     decrypted again with the new key, and the plaintext compared to the
 *     original, IN MEMORY. A row that fails is not written and aborts the run.
 *     Writing first and verifying afterwards would be exactly the mistake this
 *     script exists to prevent.
 *  3. ALL-OR-NOTHING. Every row is prepared and verified before any write
 *     happens. A half-migrated table is the worst outcome: some credentials
 *     readable under the old key, some under the new, and no single value of
 *     the env var that works.
 *  4. NO SECRET IS EVER PRINTED — not the keys, not the plaintext, not a
 *     truncated preview. Only counts and league ids.
 *
 * USAGE
 *
 *   OLD_CREDENTIAL_ENCRYPTION_KEY=... NEW_CREDENTIAL_ENCRYPTION_KEY=... \
 *     npx tsx scripts/reencrypt-credentials.ts            # dry run
 *
 *   ...same env...  npx tsx scripts/reencrypt-credentials.ts --apply
 *
 * Then, and only then, set CREDENTIAL_ENCRYPTION_KEY to the new value and
 * redeploy. Order matters: swapping the env var first strands every row.
 */
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import * as schema from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";

const KEY_BYTES = 32;
const APPLY = process.argv.includes("--apply");

function readKey(name: string): Buffer {
  const raw = process.env[name];
  if (!raw) {
    console.error(`${name} is required (base64-encoded 32 bytes).`);
    process.exit(2);
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== KEY_BYTES) {
    console.error(`${name} must decode to ${KEY_BYTES} bytes, got ${key.length}.`);
    process.exit(2);
  }
  return key;
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (typeof value === "string") return Buffer.from(value, "base64");
  throw new Error("unsupported column type for an encrypted field");
}

interface Prepared {
  leagueId: string;
  iv: Buffer;
  authTag: Buffer;
  ciphertext: Buffer;
}

async function main(): Promise<void> {
  const oldKey = readKey("OLD_CREDENTIAL_ENCRYPTION_KEY");
  const newKey = readKey("NEW_CREDENTIAL_ENCRYPTION_KEY");

  if (oldKey.equals(newKey)) {
    console.error("OLD and NEW keys are identical — nothing to do, and almost certainly a mistake.");
    process.exit(2);
  }

  const db = getDb();
  const rows = await db.select().from(schema.leagueCredentials);

  console.log(`${APPLY ? "APPLY" : "DRY RUN"} — ${rows.length} stored credential row(s).\n`);
  if (rows.length === 0) {
    console.log("Nothing to re-encrypt. The new key can be set directly.");
    return;
  }

  // Phase 1: prepare and verify EVERYTHING in memory. No writes yet.
  const prepared: Prepared[] = [];
  const failures: string[] = [];

  for (const row of rows) {
    try {
      const plaintext = decrypt(
        { iv: toBuffer(row.iv), authTag: toBuffer(row.authTag), ciphertext: toBuffer(row.ciphertext) },
        oldKey
      );

      const sealed = encrypt(plaintext, newKey);

      // Round-trip: prove the new ciphertext decrypts back to the SAME
      // plaintext before it is allowed anywhere near the database.
      const roundTripped = decrypt(sealed, newKey);
      if (roundTripped !== plaintext) {
        failures.push(`${row.leagueId}: round-trip mismatch`);
        continue;
      }

      prepared.push({
        leagueId: row.leagueId,
        iv: sealed.iv,
        authTag: sealed.authTag,
        ciphertext: sealed.ciphertext
      });
    } catch (err) {
      // Most likely cause: this row was already re-encrypted under the new key,
      // or OLD_CREDENTIAL_ENCRYPTION_KEY is not the key it was sealed with.
      failures.push(`${row.leagueId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (failures.length > 0) {
    console.error(`${failures.length} row(s) could not be re-encrypted:\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "\nABORTED. Nothing was written.\n" +
        "A partially migrated table is worse than an un-migrated one: some rows would\n" +
        "read under the old key and some under the new, with no single value of\n" +
        "CREDENTIAL_ENCRYPTION_KEY that works for all of them.\n\n" +
        "Most likely OLD_CREDENTIAL_ENCRYPTION_KEY is not the key these rows were\n" +
        "sealed with. Check it before retrying."
    );
    process.exit(1);
  }

  console.log(`All ${prepared.length} row(s) re-encrypted and round-trip verified in memory.`);

  if (!APPLY) {
    console.log("\nDRY RUN — nothing was written.");
    console.log("Re-run with --apply to commit, then set CREDENTIAL_ENCRYPTION_KEY to the");
    console.log("new value and redeploy. Setting the env var FIRST strands every row.");
    return;
  }

  // Phase 2: write. Every row is already verified.
  let written = 0;
  for (const p of prepared) {
    await db
      .update(schema.leagueCredentials)
      .set({ iv: p.iv, authTag: p.authTag, ciphertext: p.ciphertext })
      .where(eq(schema.leagueCredentials.leagueId, p.leagueId));
    written += 1;
  }

  console.log(`\nWrote ${written} row(s).`);
  console.log("NOW set CREDENTIAL_ENCRYPTION_KEY to the new value and redeploy.");
  console.log("Until you do, the app is still reading with the OLD key and will fail.");
}

main().catch((err) => {
  // Never surface a stack that might contain key material.
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
