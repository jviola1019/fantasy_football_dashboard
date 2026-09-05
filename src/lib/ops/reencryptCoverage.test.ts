import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import * as schema from "../../db/schema";

/**
 * EVERY TABLE HOLDING A SEALED CREDENTIAL MUST BE IN THE ROTATION SCRIPT.
 *
 * `scripts/reencrypt-credentials.ts` is the only way `CREDENTIAL_ENCRYPTION_KEY`
 * can ever be changed: `src/lib/crypto.ts` seals under a single key with no key
 * id and no dual-read path, so a row the script does not visit becomes
 * permanently undecryptable the moment the env var changes.
 *
 * The script was written when `leagueCredentials` was the only such table, and
 * it was complete. Then `accountCredentials` shipped — holding the pair that
 * every ESPN league now authenticates with — and the script was still complete
 * *looking*: it ran, reported success, and would have stranded the important
 * table. Nobody would find out until after the rotation, which is the worst
 * possible moment.
 *
 * So the list stops being something to remember. A credential table is
 * identified structurally — it carries `iv`, `authTag` and `ciphertext` — and
 * this fails if one exists that the script never names.
 */
const SCRIPT = join(__dirname, "..", "..", "..", "scripts", "reencrypt-credentials.ts");

/** A table is credential-bearing if it stores an AES-GCM seal. */
function sealedTableNames(): string[] {
  const names: string[] = [];
  for (const value of Object.values(schema)) {
    if (!is(value, Table)) continue;
    const columns = Object.keys(getTableColumns(value));
    const sealed = ["iv", "authTag", "ciphertext"].every((c) => columns.includes(c));
    if (sealed) names.push(getTableName(value));
  }
  return names.sort();
}

describe("the key-rotation script covers every sealed table", () => {
  const source = readFileSync(SCRIPT, "utf8");
  const tables = sealedTableNames();

  it("finds the credential tables structurally, so this cannot pass vacuously", () => {
    // If the detection ever matches nothing, the assertion below becomes a
    // loop over an empty array — green, and blind. This is the same failure
    // mode as a scanner whose regex stopped matching.
    expect(tables).toEqual(["accountCredentials", "leagueCredentials"]);
  });

  it("names every one of them in scripts/reencrypt-credentials.ts", () => {
    for (const table of tables) {
      expect(
        source.includes(`schema.${table}`),
        `${table} stores sealed credentials but scripts/reencrypt-credentials.ts ` +
          `never reads it. Rotating CREDENTIAL_ENCRYPTION_KEY would leave every ` +
          `row in ${table} undecryptable, with no way back.`
      ).toBe(true);
    }
  });

  it("both SELECTs and UPDATEs each one", () => {
    // Reading a table without writing it back is the half-migration the script's
    // own header calls the worst outcome: some rows under the old key, some
    // under the new, and no single env var value that works.
    for (const table of tables) {
      expect(source, `${table} is read but never updated`).toContain(`.from(schema.${table})`);
      expect(source, `${table} is not written back`).toContain(`.update(schema.${table})`);
    }
  });

  it("would notice a table it does not name — the canary", () => {
    // Proves the check above can actually fail. A schema table that does not
    // exist must not be found in the script, or `includes` is matching
    // something it should not.
    expect(source.includes("schema.vaultCredentials")).toBe(false);
  });
});
