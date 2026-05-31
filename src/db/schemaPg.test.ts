import { describe, expect, it } from "vitest";
import { getTableName } from "drizzle-orm";
import * as pg from "./schema-pg";
import { INIT_SQL } from "./schema-pg";

const ALL_PG_TABLES = [
  pg.users,
  pg.accounts,
  pg.sessions,
  pg.verificationTokens,
  pg.leagues,
  pg.leagueCredentials,
  pg.notifications,
  pg.playersSnapshots,
  pg.rankingsSnapshots,
  pg.ktcSnapshots,
  pg.projectionsSnapshots,
  pg.newsSnapshots
];

describe("INIT_SQL coverage (M4 guard)", () => {
  it("creates every pgTable defined in schema-pg", () => {
    for (const table of ALL_PG_TABLES) {
      const name = getTableName(table);
      // INIT_SQL quotes mixed-case identifiers; accept quoted or unquoted.
      const re = new RegExp(`CREATE TABLE IF NOT EXISTS "?${name}"?`);
      expect(INIT_SQL, `INIT_SQL is missing CREATE TABLE for ${name}`).toMatch(re);
    }
  });

  it("creates the source/fetchedAt index for every snapshot table", () => {
    for (const table of ALL_PG_TABLES) {
      const name = getTableName(table);
      if (!name.endsWith("_snapshots")) continue;
      const re = new RegExp(`CREATE INDEX IF NOT EXISTS ${name}_source_fetched`);
      expect(INIT_SQL, `INIT_SQL is missing the index for ${name}`).toMatch(re);
    }
  });
});
