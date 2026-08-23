// Validation for security/exceptions.json. Pure, stdlib-only, unit-tested; the
// CLI lives in scripts/check-vuln-exceptions.ts.
//
// Audit 2026-08-06 F-006. The point of this module is that an exception decays:
// a stale entry fails the build rather than silently keeping a known
// vulnerability suppressed forever.

export type Severity = "critical" | "high" | "moderate" | "low" | "info";

export interface VulnException {
  advisory: string;
  package: string;
  introducedBy?: string;
  severity: Severity;
  scope: "production" | "development";
  justification: string;
  compensatingControl: string;
  owner: string;
  opened: string;
  expires: string;
  review?: string;
}

export interface ExceptionPolicy {
  failOn: Severity[];
  failOnDev: Severity[];
  maxDurationDays: number;
}

export interface ExceptionsFile {
  policy: ExceptionPolicy;
  exceptions: VulnException[];
}

export interface ExceptionProblem {
  advisory: string;
  problem: string;
}

const REQUIRED_TEXT: Array<keyof VulnException> = [
  "advisory",
  "package",
  "justification",
  "compensatingControl",
  "owner"
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const GHSA = /^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;

function parseDate(value: string): Date | null {
  if (!ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}

const DAY_MS = 86_400_000;

/**
 * Every reason the exceptions file should fail CI. An empty array means the
 * file is well-formed AND no entry has expired.
 */
export function validateExceptions(file: ExceptionsFile, now: Date): ExceptionProblem[] {
  const problems: ExceptionProblem[] = [];
  const seen = new Set<string>();

  const maxDays = file.policy?.maxDurationDays;
  if (typeof maxDays !== "number" || maxDays <= 0) {
    problems.push({ advisory: "(policy)", problem: "policy.maxDurationDays must be a positive number" });
  }
  if (!Array.isArray(file.policy?.failOn)) {
    problems.push({ advisory: "(policy)", problem: "policy.failOn must be an array" });
  }

  for (const entry of file.exceptions ?? []) {
    const id = entry?.advisory ?? "(missing advisory)";

    for (const field of REQUIRED_TEXT) {
      const value = entry?.[field];
      if (typeof value !== "string" || value.trim().length === 0) {
        problems.push({ advisory: id, problem: `missing required field: ${field}` });
      }
    }
    // A one-word justification is not a justification.
    if (typeof entry?.justification === "string" && entry.justification.trim().length < 40) {
      problems.push({ advisory: id, problem: "justification is too short to be meaningful" });
    }
    if (typeof entry?.compensatingControl === "string" && entry.compensatingControl.trim().length < 20) {
      problems.push({ advisory: id, problem: "compensatingControl is too short to be meaningful" });
    }
    if (typeof entry?.advisory === "string" && !GHSA.test(entry.advisory)) {
      problems.push({ advisory: id, problem: "advisory must be a GHSA identifier" });
    }
    if (entry?.scope !== "production" && entry?.scope !== "development") {
      problems.push({ advisory: id, problem: "scope must be 'production' or 'development'" });
    }
    if (seen.has(id)) {
      problems.push({ advisory: id, problem: "duplicate exception entry" });
    }
    seen.add(id);

    const opened = parseDate(entry?.opened ?? "");
    const expires = parseDate(entry?.expires ?? "");
    if (!opened) problems.push({ advisory: id, problem: "opened must be an ISO date (YYYY-MM-DD)" });
    if (!expires) {
      problems.push({ advisory: id, problem: "expires must be an ISO date (YYYY-MM-DD)" });
      continue;
    }

    // The whole mechanism: a lapsed exception turns the build red.
    if (expires.getTime() <= now.getTime()) {
      problems.push({
        advisory: id,
        problem: `EXPIRED on ${entry.expires} — re-review, upgrade, or consciously re-date it`
      });
    }
    if (opened && typeof maxDays === "number" && maxDays > 0) {
      const days = (expires.getTime() - opened.getTime()) / DAY_MS;
      if (days > maxDays) {
        problems.push({
          advisory: id,
          problem: `duration ${Math.round(days)}d exceeds policy maximum of ${maxDays}d`
        });
      }
    }
  }

  return problems;
}

/** Advisory IDs that are currently suppressed (unexpired and well-formed). */
export function activeExceptionIds(file: ExceptionsFile, now: Date): Set<string> {
  const active = new Set<string>();
  for (const entry of file.exceptions ?? []) {
    const expires = parseDate(entry?.expires ?? "");
    if (expires && expires.getTime() > now.getTime()) active.add(entry.advisory);
  }
  return active;
}
