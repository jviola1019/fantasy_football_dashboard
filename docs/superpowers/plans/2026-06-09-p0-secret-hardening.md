# P0 Secret-Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the repo from ever again committing real secrets — redact the leaked values in `DEPLOY_TO_VERCEL.md` and add a tested, CI-enforced `check-doc-secrets` guard.

**Architecture:** A small pure detector (`findSecretLeaks`) flags high-entropy literals that sit on the same line as a secret keyword, with an allowlist for placeholders/CI dummies. A thin CLI walks `git ls-files`-tracked `*.md`/`*.json`/`*.env*` files and exits non-zero on any leak. The CLI is wired into the CI `quality` job. The detector is TDD'd; the file walk is tested via an injected reader so no fixture files are needed.

**Tech Stack:** TypeScript run via `tsx`, Vitest, GitHub Actions.

**Out of scope (user's manual Vercel action):** rotating `AUTH_SECRET` / `CREDENTIAL_ENCRYPTION_KEY` / `DB_INIT_TOKEN`. Rotation is the only thing that neutralizes the already-public values; this plan only stops recurrence and removes them from the working tree. Optional history scrub (`git filter-repo`) is a separate follow-up.

**Branch:** work on `audit/2026-06-09`; open PR "P0: secret hardening" → `main`.

---

### Task 1: Add `tsx` dev dependency and npm script

**Files:**
- Modify: `package.json` (devDependencies + scripts)

- [ ] **Step 1: Add the dependency and script**

In `package.json`, add to `devDependencies` (keep alphabetical neighbours intact):

```json
    "tsx": "^4.19.2",
```

Add to `scripts`:

```json
    "check:secrets": "tsx scripts/check-doc-secrets.ts",
```

- [ ] **Step 2: Install**

Run: `npm install`
Expected: `tsx` resolved; `package-lock.json` updated; exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add tsx + check:secrets script for the secret guard"
```

---

### Task 2: TDD the `findSecretLeaks` detector

**Files:**
- Create: `scripts/check-doc-secrets.ts`
- Test: `scripts/check-doc-secrets.test.ts`

- [ ] **Step 1: Write the failing test**

Create `scripts/check-doc-secrets.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findSecretLeaks, scanFiles } from "./check-doc-secrets";

describe("findSecretLeaks", () => {
  it("flags a real base64 secret next to a keyword (markdown table row)", () => {
    const text = "| `AUTH_SECRET` | `Qp7Lm2Xv9Rt4Wy6Zb8Nc1Df3Gh5Jk0Ab2Cd4Ef6Hj8=` |";
    expect(findSecretLeaks(text)).toHaveLength(1);
  });

  it("flags a token in a curl header", () => {
    const text = 'curl -H "x-init-token: Qp7Lm2Xv9Rt4Wy6Zb8Nc1Df3Gh5Jk0A"';
    expect(findSecretLeaks(text)).toHaveLength(1);
  });

  it("passes placeholder values", () => {
    const text = "| `AUTH_SECRET` | `your-32-byte-base64-secret-here` |";
    expect(findSecretLeaks(text)).toHaveLength(0);
  });

  it("passes redacted prefixes used in audit reports", () => {
    const text = "AUTH_SECRET (`LgWf0D/pj…`) — NextAuth JWT signing key";
    expect(findSecretLeaks(text)).toHaveLength(0);
  });

  it("ignores a high-entropy token with no secret keyword on the line", () => {
    const text = "the snapshot hash is 9f8e7d6c5b4a39281706f5e4d3c2b1a0ffeeddcc";
    expect(findSecretLeaks(text)).toHaveLength(0);
  });

  it("ignores an all-same-char CI dummy", () => {
    const text = "CREDENTIAL_ENCRYPTION_KEY: AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
    expect(findSecretLeaks(text)).toHaveLength(0);
  });
});

describe("scanFiles", () => {
  it("aggregates leaks per file using an injected reader", () => {
    const read = (p: string) =>
      p === "bad.md"
        ? "DB_INIT_TOKEN = Qp7Lm2Xv9Rt4Wy6Zb8Nc1Df3Gh5Jk0A"
        : "nothing secret here";
    const res = scanFiles(["bad.md", "good.md"], read);
    expect(Object.keys(res)).toEqual(["bad.md"]);
    expect(res["bad.md"]).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/check-doc-secrets.test.ts`
Expected: FAIL — cannot resolve `./check-doc-secrets` (module not created yet).

- [ ] **Step 3: Write minimal implementation (detector + scanner, no CLI yet)**

Create `scripts/check-doc-secrets.ts`:

```ts
// Detects high-entropy literals that sit on the same line as a secret keyword.
// Pure functions are exported for tests; the CLI (Task 3) is added below them.

const SECRET_KEYWORDS =
  /(AUTH_SECRET|CREDENTIAL_ENCRYPTION_KEY|DB_INIT_TOKEN|x-init-token|CRON_SECRET|[A-Z][A-Z0-9_]*SECRET|[A-Z][A-Z0-9_]*TOKEN|[A-Z][A-Z0-9_]*API_KEY|PASSWORD|PRIVATE_KEY)/;

// base64 of >=24 chars (32 raw bytes => 43-44 chars) OR hex of >=32 chars
const TOKEN_RE = /[A-Za-z0-9+/]{24,}={0,2}|[a-fA-F0-9]{32,}/g;

const ALLOW_SUBSTRINGS = [
  "your-", "example", "placeholder", "xxxx", "<", "randombytes",
  "ci-auth-secret", "do-not-use", "generate", "openssl",
];

export interface Leak {
  line: number;
  keyword: string;
  token: string; // redacted preview
}

function isAllowed(token: string, lineLower: string): boolean {
  if (ALLOW_SUBSTRINGS.some((a) => lineLower.includes(a))) return true;
  // all-same-character dummies like AAAA...=
  if (/^(.)\1+={0,2}$/.test(token)) return true;
  return false;
}

export function findSecretLeaks(text: string): Leak[] {
  const leaks: Leak[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const kw = raw.match(SECRET_KEYWORDS);
    if (!kw) return;
    const lower = raw.toLowerCase();
    const tokens = raw.match(TOKEN_RE) ?? [];
    for (const t of tokens) {
      if (t.length < 24) continue;
      if (isAllowed(t, lower)) continue;
      leaks.push({ line: i + 1, keyword: kw[0], token: `${t.slice(0, 6)}…(${t.length} chars)` });
    }
  });
  return leaks;
}

export function scanFiles(
  paths: string[],
  read: (p: string) => string
): Record<string, Leak[]> {
  const result: Record<string, Leak[]> = {};
  for (const p of paths) {
    const leaks = findSecretLeaks(read(p));
    if (leaks.length) result[p] = leaks;
  }
  return result;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/check-doc-secrets.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add scripts/check-doc-secrets.ts scripts/check-doc-secrets.test.ts
git commit -m "feat(security): tested secret-leak detector for tracked docs"
```

---

### Task 3: Add the CLI file walk and confirm it catches the real leak

**Files:**
- Modify: `scripts/check-doc-secrets.ts` (append CLI)

- [ ] **Step 1: Append the CLI to `scripts/check-doc-secrets.ts`**

Add at the end of the file:

```ts
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

function trackedTextFiles(): string[] {
  const out = execSync("git ls-files", { encoding: "utf8" });
  return out
    .split("\n")
    .filter(Boolean)
    .filter((f) => /\.(md|json)$/i.test(f) || /(^|\/)\.env/i.test(f));
}

function main(): void {
  const files = trackedTextFiles();
  const found = scanFiles(files, (p) => readFileSync(p, "utf8"));
  const entries = Object.entries(found);
  if (entries.length === 0) {
    console.log(`check-doc-secrets: scanned ${files.length} tracked files — no secret-shaped literals.`);
    return;
  }
  for (const [file, leaks] of entries) {
    for (const l of leaks) {
      console.error(`${file}:${l.line}  possible ${l.keyword} secret → ${l.token}`);
    }
  }
  console.error(`\ncheck-doc-secrets: FAILED — ${entries.length} file(s) contain secret-shaped literals. Redact them.`);
  process.exit(1);
}

// Run main() only when executed directly (not when imported by tests).
if (process.argv[1] && /check-doc-secrets\.ts$/.test(process.argv[1])) {
  main();
}
```

- [ ] **Step 2: Run the guard against the repo AS-IS — it MUST fail on the real leak**

Run: `npx tsx scripts/check-doc-secrets.ts`
Expected: FAIL (exit 1) with at least:
```
DEPLOY_TO_VERCEL.md:34  possible AUTH_SECRET secret → LgWf0D…(44 chars)
DEPLOY_TO_VERCEL.md:35  possible CREDENTIAL_ENCRYPTION_KEY secret → w5i6GX…(44 chars)
DEPLOY_TO_VERCEL.md:36  possible DB_INIT_TOKEN secret → KiqQvP…(32 chars)
DEPLOY_TO_VERCEL.md:52  possible x-init-token secret → KiqQvP…(32 chars)
```
(This proves the detector works on the genuine leak before we redact.)

- [ ] **Step 3: Confirm the detector does NOT flag the committed audit reports**

Run: `npx tsx scripts/check-doc-secrets.ts` and verify the only failing file is `DEPLOY_TO_VERCEL.md` (the redacted prefixes in `reports/audit-2026-06-09/*.md` are < 24 chars and must not appear).
Expected: no `reports/audit-2026-06-09/` paths in the output.

- [ ] **Step 4: Re-run the unit tests (CLI import guard must not break them)**

Run: `npx vitest run scripts/check-doc-secrets.test.ts`
Expected: PASS (8 tests; `main()` did not execute during import).

- [ ] **Step 5: Commit**

```bash
git add scripts/check-doc-secrets.ts
git commit -m "feat(security): check-doc-secrets CLI walks tracked docs (fails on current leak)"
```

---

### Task 4: Redact the leaked secrets in `DEPLOY_TO_VERCEL.md`

**Files:**
- Modify: `DEPLOY_TO_VERCEL.md:32-40,50-53`

- [ ] **Step 1: Replace the secret table with placeholders + a generate step**

Replace lines 32-40 (the table through the warning blockquote) with:

```markdown
| Variable | Value |
| --- | --- |
| `AUTH_SECRET` | _Generate (below); set in Vercel only — never commit._ |
| `CREDENTIAL_ENCRYPTION_KEY` | _Generate (below); set in Vercel only — never commit._ |
| `DB_INIT_TOKEN` | _Generate (below); set in Vercel only — never commit._ |
| `DATABASE_URL` | already set by the Neon integration in step 3 |

Generate each value locally and paste it straight into Vercel (never into a file):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # AUTH_SECRET
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"   # CREDENTIAL_ENCRYPTION_KEY
node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"      # DB_INIT_TOKEN
```

> These are real secrets. If one ever lands in a file or a chat, rotate it immediately in
> Vercel (and clear `leagueCredentials` when rotating `CREDENTIAL_ENCRYPTION_KEY`).
```

- [ ] **Step 2: De-literal the curl token (line ~52)**

Replace the bootstrap curl block so it reads the token from the environment instead of inlining it:

```bash
DB_INIT_TOKEN=… \
curl -X POST https://<your-project>.vercel.app/api/admin/init-db \
  -H "x-init-token: $DB_INIT_TOKEN"
```

- [ ] **Step 3: Run the guard — it MUST now pass**

Run: `npx tsx scripts/check-doc-secrets.ts`
Expected: `check-doc-secrets: scanned N tracked files — no secret-shaped literals.` (exit 0).

- [ ] **Step 4: Commit**

```bash
git add DEPLOY_TO_VERCEL.md
git commit -m "security: redact leaked secrets in deploy doc; generate-and-set instructions"
```

---

### Task 5: Wire the guard into CI

**Files:**
- Modify: `.github/workflows/ci.yml:24-27`

- [ ] **Step 1: Add the secret-check step to the `quality` job**

In `.github/workflows/ci.yml`, inside the `quality` job's `steps:`, add a step immediately after `- run: npm ci --no-audit --no-fund` (line 24) and before `- run: npx tsc --noEmit`:

```yaml
      - run: npx tsx scripts/check-doc-secrets.ts
```

- [ ] **Step 2: Sanity-check the workflow YAML locally**

Run: `node -e "require('fs').readFileSync('.github/workflows/ci.yml','utf8')"` then visually confirm indentation matches the surrounding `- run:` steps (2-space list under `steps:`).
Expected: no error; step aligned with siblings.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: fail the build if a tracked doc contains a secret-shaped literal"
```

---

### Task 6: Full local gate sweep + open PR

- [ ] **Step 1: Run the gates that work locally**

Run each and confirm exit 0:
```bash
npx tsc --noEmit
npx eslint .
npx vitest run
npx tsx scripts/check-doc-secrets.ts
```
Expected: typecheck ✓, lint ✓, vitest (≥ prior 442 passing, now + the 8 new tests), secret-check ✓.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin audit/2026-06-09
```
Open PR "P0: secret hardening (redact deploy doc + CI guard)" → `main`. In the description, include the **manual rotation checklist** for the user (rotate the three keys in Vercel; clear `leagueCredentials` when rotating the encryption key) and note these code changes do **not** substitute for rotation.

- [ ] **Step 3: Verify CI is green on the PR**

Watch the `quality` job: the new `check-doc-secrets` step must pass (proving the redaction worked) alongside typecheck/lint/vitest.

---

## Self-review

- **Spec coverage:** SEC-01 redaction ✓ (Task 4), `check-doc-secrets` script + CI guard ✓ (Tasks 2/3/5), test coverage ✓ (Task 2). Rotation correctly flagged out-of-code-scope and surfaced in the PR body (Task 6). ✓
- **Placeholder scan:** every code step contains complete, runnable code; no TBD/TODO. ✓
- **Type consistency:** `findSecretLeaks`/`scanFiles`/`Leak` defined in Task 2 and reused unchanged in Task 3. ✓

---

## Subsequent plans (one per PR block — detailed when each is started)

These are intentionally NOT expanded here; each will get its own `docs/superpowers/plans/` file when we open its PR, so it reflects what earlier PRs settle.

- **P1-quant** — `scripts/brier-season-sim.ts`: real playoff/championship Brier + reliability curve + Murphy decomposition; remove the unmeasured printed targets from `brier-backtest.ts`; gate calibration vocabulary on measured evidence. **Open question to resolve first:** season-level outcomes are sparse (one data point per league-season) and it is the 2026 offseason — the plan must define the historical sample (e.g., completed 2025 Sleeper leagues) and report wide uncertainty honestly rather than overclaim.
- **P1-fe** — replace fabricated `P10/P90` in `TeamSignals.tsx:36-61` with real `sim.distribution` percentiles or relabel illustrative.
- **P1-devops** — `scripts/smoke-vercel.ts` + a post-deploy CI job hitting the live URL; branch-protection writeup (user GitHub action).
- **P2-data** — universe/free-agent truncation disclosure + shared `UNIVERSE_LIMIT`.
- **P2-fe/a11y** — reduced-motion for Framer-Motion; delete dead `ui/tabs.tsx`; rename draft "Multiverse"; Heatmap2D aria-label; dedupe reduced-motion CSS.
- **P2-ci/obs** — `engines` field; CI `needs:` ordering + build dedup; `opportunity-refresh` function config; error tracking + cron alerting + `scripts/check-cron-freshness.ts`.
- **P3** — remaining S3 polish; branch prune (14 refs); ff local `main`; 5 semver tags.
