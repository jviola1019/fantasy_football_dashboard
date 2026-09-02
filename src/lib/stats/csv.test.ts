import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join } from "node:path";
import { parseCsv, parseCsvRows } from "./csv";

describe("parseCsv handles the cases a split(',') gets wrong", () => {
  it("keeps a quoted comma inside one field", () => {
    // THE CASE THAT COST A WHOLE ANALYSIS. nflverse quotes any field containing
    // a comma, and a naive split returns one field too many for that row —
    // shifting every subsequent value into the wrong column.
    const rows = parseCsv('a,b,c\n1,"Smith, John",3');
    expect(rows[1]).toEqual(["1", "Smith, John", "3"]);
    expect(rows[1]!.length).toBe(rows[0]!.length);
  });

  it("unescapes a doubled quote", () => {
    expect(parseCsv('a\n"he said ""hi"""')[1]).toEqual(['he said "hi"']);
  });

  it("keeps empty fields rather than collapsing them", () => {
    expect(parseCsv("a,b,c\n1,,3")[1]).toEqual(["1", "", "3"]);
  });

  it("handles CRLF", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"]
    ]);
  });

  it("keeps a newline inside a quoted field on one row", () => {
    const rows = parseCsv('a,b\n1,"line1\nline2"');
    expect(rows.length).toBe(2);
    expect(rows[1]![1]).toBe("line1\nline2");
  });
});

describe("parseCsvRows refuses misaligned rows instead of misreading them", () => {
  it("drops and counts a row with the wrong field count", () => {
    const out = parseCsvRows("a,b,c\n1,2,3\n1,2\n1,2,3,4");
    expect(out.rows).toEqual([{ a: "1", b: "2", c: "3" }]);
    expect(out.malformed).toBe(2);
  });

  it("does not count a trailing blank line as malformed", () => {
    const out = parseCsvRows("a,b\n1,2\n");
    expect(out.rows.length).toBe(1);
    expect(out.malformed).toBe(0);
  });

  it("returns the count so a caller can refuse to proceed", () => {
    // The point of returning rather than logging: a script that loses most of
    // its input and one that reads a clean file look identical from outside.
    const out = parseCsvRows("a,b\n1,2\n1\n1\n1\n");
    expect(out.malformed).toBe(3);
    expect(out.malformed / (out.malformed + out.rows.length)).toBeGreaterThan(0.5);
  });
});

describe("it reads the real nflverse bundle correctly", () => {
  /**
   * A parser test on invented strings proves the parser handles what I imagined.
   * This one runs it over the committed 6 MB bundle the analyses actually use.
   */
  const bundlePath = join(__dirname, "..", "..", "..", "reports/2026-08-20/nflverse-usage.json.gz");
  const bundle = JSON.parse(gunzipSync(readFileSync(bundlePath)).toString("utf8")) as Record<string, string>;

  it("parses every season with no malformed rows", () => {
    let totalRows = 0;
    for (const key of Object.keys(bundle).filter((k) => k.startsWith("player_stats_"))) {
      const out = parseCsvRows(bundle[key]!);
      expect(out.malformed, `${key} has ${out.malformed} misaligned rows`).toBe(0);
      expect(out.rows.length, `${key} parsed empty`).toBeGreaterThan(1000);
      totalRows += out.rows.length;
    }
    expect(totalRows).toBeGreaterThan(30_000);
  });

  it("puts real values in the columns the analyses filter on", () => {
    // The regression this exists to catch: with a naive split these read "1"
    // and "2022" — the week and the season, one column to the left.
    const out = parseCsvRows(bundle.player_stats_2022!);
    const seasonTypes = new Set(out.rows.map((r) => r.season_type));
    expect([...seasonTypes].sort()).toEqual(["POST", "REG"]);
    const weeks = new Set(out.rows.map((r) => Number(r.week)));
    expect(Math.min(...weeks)).toBe(1);
    expect(Math.max(...weeks)).toBeLessThanOrEqual(22);
    for (const r of out.rows.slice(0, 200)) {
      expect(r.player_id).toMatch(/^00-\d{7}$/);
      expect(Number(r.season)).toBe(2022);
    }
  });

  it("finds the rows a naive split loses", () => {
    // Canary: prove the quoted-comma case is actually present in this data, so
    // the test above is not passing because the hazard is absent.
    const naive = bundle
      .player_stats_2022!.trim()
      .split(/\r?\n/)
      .slice(1)
      .filter((line) => line.split(",").length !== 53);
    expect(naive.length, "expected quoted commas in the real bundle").toBeGreaterThan(0);
  });
});
