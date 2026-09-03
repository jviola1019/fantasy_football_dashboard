/**
 * RFC 4180 CSV parsing, with one home and a column-count contract.
 *
 * WHY THIS IS NOT `text.split(",")`.
 *
 * nflverse's `player_stats` files quote any field containing a comma — most
 * often `player_display_name`. A naive split therefore returns 54 fields for a
 * 53-column header on those rows, and every value after the quoted field is
 * shifted by one. That is not a parse error anybody sees: `season_type` reads
 * "1", `week` reads "2022", and the filter `season_type === "REG"` quietly
 * matches nothing. Measured 2026-09-02 while writing `validate-variables.ts`,
 * which produced **zero player-seasons out of eight seasons of real data** and
 * still wrote a report concluding that no variable was significant.
 *
 * A correct implementation already existed inside
 * `scripts/anova-opportunity.ts`, where nothing else could import it — the same
 * shape as the `fingerprintRows` split, and the reason both now live here.
 *
 * `parseCsvRows` also REFUSES a row whose field count disagrees with the header,
 * rather than padding or truncating. A misaligned row is not partially usable
 * data; it is a different row's values under this row's names.
 */

/** Split CSV text into rows of raw fields, honouring quotes and escaped quotes. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let quoted = false;
  let row: string[] = [];
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

export interface CsvParseResult {
  rows: Record<string, string>[];
  header: string[];
  /** Rows dropped because their field count disagreed with the header. */
  malformed: number;
}

/**
 * Parse to objects keyed by header, dropping — and COUNTING — misaligned rows.
 *
 * The count is returned rather than logged so a caller can refuse to proceed. A
 * parser that silently drops most of its input and a parser that reads a clean
 * file look identical from the outside, and that is the failure this module was
 * written after.
 */
export function parseCsvRows(text: string): CsvParseResult {
  const raw = parseCsv(text.trim());
  if (raw.length === 0) return { rows: [], header: [], malformed: 0 };
  const header = raw[0]!;
  const rows: Record<string, string>[] = [];
  let malformed = 0;
  for (let i = 1; i < raw.length; i += 1) {
    const parts = raw[i]!;
    // A trailing blank line parses as one empty field; that is not malformed.
    if (parts.length === 1 && parts[0] === "") continue;
    if (parts.length !== header.length) {
      malformed += 1;
      continue;
    }
    const obj: Record<string, string> = {};
    for (let j = 0; j < header.length; j += 1) obj[header[j]!] = parts[j]!;
    rows.push(obj);
  }
  return { rows, header, malformed };
}
