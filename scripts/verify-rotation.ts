/**
 * Verify a secret rotation actually took effect (audit §11).
 *
 * WHY THIS EXISTS
 *
 * Confirming the NEW value works proves only that it was accepted. It does not
 * prove the OLD value is dead — and a rotation where the old credential still
 * authenticates is not a rotation. So the check this script leads with is
 * REJECTION of the previous value, which is the only direct evidence.
 *
 * SAFETY
 *
 *   - Secrets are read from the ENVIRONMENT only. Never an argument (argv lands
 *     in shell history and process listings) and never a file.
 *   - Values are never printed, not even truncated.
 *   - The default run is READ-ONLY in effect: it sends credentials the server is
 *     expected to REJECT, so nothing mutates. Confirming the new secret is
 *     opt-in behind --check-new, because POST /api/admin/init-db applies DDL and
 *     a production database mutation needs a deliberate decision.
 *
 * USAGE
 *
 *   RAE_VERIFY_BASE_URL=https://your-app.vercel.app \
 *   OLD_DB_INIT_TOKEN=... OLD_CRON_SECRET=... \
 *     npx tsx scripts/verify-rotation.ts
 *
 * Add --check-new with NEW_CRON_SECRET to also confirm the new value is
 * accepted (cron routes are read-only; init-db is not and stays excluded).
 */

interface Check {
  name: string;
  detail: string;
  /** true = rotation confirmed for this credential. */
  pass: boolean;
  observed: string;
}

const BASE = process.env.RAE_VERIFY_BASE_URL?.replace(/\/+$/, "");
const CHECK_NEW = process.argv.includes("--check-new");

/** Any 2xx here means the credential still authenticates. */
const REJECTED = new Set([401, 403]);

async function probe(path: string, headers: Record<string, string>): Promise<number | null> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: path.includes("/admin/") ? "POST" : "GET",
      headers,
      redirect: "manual"
    });
    return res.status;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (!BASE) {
    console.error("RAE_VERIFY_BASE_URL is required (e.g. https://your-app.vercel.app).");
    process.exit(2);
  }
  if (!/^https:\/\//.test(BASE)) {
    // Sending a credential over plaintext http would leak the very value being
    // retired, which is worse than not running the check.
    console.error("RAE_VERIFY_BASE_URL must be https — refusing to send credentials over http.");
    process.exit(2);
  }

  const checks: Check[] = [];
  const skipped: string[] = [];

  const oldInit = process.env.OLD_DB_INIT_TOKEN;
  if (oldInit) {
    const status = await probe("/api/admin/init-db", { "x-init-token": oldInit });
    checks.push({
      name: "DB_INIT_TOKEN",
      detail: "previous value must be REJECTED by POST /api/admin/init-db",
      pass: status != null && REJECTED.has(status),
      observed: status == null ? "request failed" : `HTTP ${status}`
    });
  } else skipped.push("OLD_DB_INIT_TOKEN");

  const oldCron = process.env.OLD_CRON_SECRET;
  if (oldCron) {
    const status = await probe("/api/cron/lifecycle-check", { authorization: `Bearer ${oldCron}` });
    checks.push({
      name: "CRON_SECRET",
      detail: "previous value must be REJECTED by GET /api/cron/lifecycle-check",
      pass: status != null && REJECTED.has(status),
      observed: status == null ? "request failed" : `HTTP ${status}`
    });
  } else skipped.push("OLD_CRON_SECRET");

  if (CHECK_NEW) {
    const newCron = process.env.NEW_CRON_SECRET;
    if (newCron) {
      const status = await probe("/api/cron/lifecycle-check", { authorization: `Bearer ${newCron}` });
      checks.push({
        name: "CRON_SECRET (new)",
        detail: "new value must be ACCEPTED",
        pass: status != null && !REJECTED.has(status) && status < 500,
        observed: status == null ? "request failed" : `HTTP ${status}`
      });
    } else skipped.push("NEW_CRON_SECRET");
  }

  console.log(`Rotation verification against ${BASE}\n`);
  if (checks.length === 0) {
    console.error("Nothing to verify — no OLD_* secret was provided in the environment.");
    console.error("This is NOT a pass. Rotation is unverified.");
    process.exit(2);
  }

  for (const c of checks) {
    console.log(`${c.pass ? "PASS" : "FAIL"}  ${c.name}`);
    console.log(`      ${c.detail}`);
    console.log(`      observed: ${c.observed}\n`);
  }
  if (skipped.length > 0) {
    console.log(`Not checked (not supplied): ${skipped.join(", ")}`);
    console.log("Those credentials remain UNVERIFIED — absence of a check is not a pass.\n");
  }

  const failed = checks.filter((c) => !c.pass);
  if (failed.length > 0) {
    console.error(`${failed.length} check(s) FAILED. A previous credential that still`);
    console.error("authenticates means the rotation did not take effect — re-check the");
    console.error("secret store and confirm a redeploy happened after the value changed.");
    process.exit(1);
  }
  console.log("All supplied credentials confirmed rotated: previous values are rejected.");
  console.log("Record the date and which secrets in the audit ledger — never the values.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
