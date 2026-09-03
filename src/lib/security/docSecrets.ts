// Detects high-entropy literals that sit on the same line as a secret keyword.
// Pure, stdlib-only, and unit-tested; the CLI lives in scripts/check-doc-secrets.ts.

import { createHash } from "node:crypto";

/**
 * SHA-256 hex digests of the three secrets that leaked into public git history
 * in May 2026 (redacted at tip in f363637, rotated since — see
 * reports/audit-2026-07-08-fable.md A-01). The plaintexts are burned forever;
 * this deny-list stops any tracked file from ever re-introducing them (e.g. by
 * restoring an old doc revision). Stored as digests so this file never
 * contains the leaked values themselves.
 */
export const BURNED_SECRET_HASHES: ReadonlySet<string> = new Set([
  "d73464c6bbdba4c0c09838ed22b024af87c1c6d085cb5b85f624afa94aa90ecc", // AUTH_SECRET (2026-05)
  "4e57df6a02fda9ab2478c2ff23e306455fadc9b3bed3c37128898c3367d85323", // CREDENTIAL_ENCRYPTION_KEY (2026-05)
  "469eb8d606044d3b6f7ea496412e066222f9ff3cb3b4f236f662126b8a3d2c13", // DB_INIT_TOKEN (2026-05)
  // ESPN session cookies exposed in an operator chat transcript on 2026-08-13
  // (audit 2026-08-06 F-009). They were never committed — verified against the
  // working tree AND full git history — but they must now be permanently
  // uncommittable. Rotating them (ESPN sign-out/sign-in) is the owner action
  // that actually invalidates them; this only guarantees they cannot land here.
  "62938a08035114bd6a7bbeb0e72ad648276d5b0373717262c9d58c912b34b9e4", // espn_s2 (2026-08)
  "859ab1b004fb46cfda206deb4c9c4708f4324103ccfbb4bbc5037fb33adfc0ec", // SWID, braced (2026-08)
  "4c63945bf995747d92d48e699692aa93183fbebcbb25b3e3f016ed205f3366b2" // SWID, unbraced (2026-08)
]);

function isBurned(token: string, burned: ReadonlySet<string>): boolean {
  return burned.has(createHash("sha256").update(token).digest("hex"));
}

const SECRET_KEYWORDS =
  /(AUTH_SECRET|CREDENTIAL_ENCRYPTION_KEY|DB_INIT_TOKEN|x-init-token|CRON_SECRET|[A-Z][A-Z0-9_]*SECRET|[A-Z][A-Z0-9_]*TOKEN|[A-Z][A-Z0-9_]*API_KEY|PASSWORD|PRIVATE_KEY)/;

// base64 of >=24 chars (32 raw bytes => 43-44 chars) OR hex of >=32 chars
const TOKEN_RE = /[A-Za-z0-9+/]{24,}={0,2}|[a-fA-F0-9]{32,}/g;

// A value assigned after a secret keyword: `KEY = value`, `KEY: value`, or a
// markdown/JSON `"value"`. Captures special-character secrets (passwords) that
// the base64/hex TOKEN_RE misses (reviewer Issue 2). Entropy-guarded below.
const ASSIGN_RE = /[:=]\s*["'`]?([^\s"'`|,}]{12,})["'`]?/g;

const ALLOW_SUBSTRINGS = [
  "your-",
  "your_",
  "example",
  "placeholder",
  "xxxx",
  "<",
  "randombytes",
  "ci-auth-secret",
  "do-not-use",
  "generate",
  "openssl",
  "replace_me",
  "replace-me",
  "changeme",
  "change-me",
  "rand_base64",
  "base64url",
];

export interface Leak {
  line: number;
  keyword: string;
  token: string; // redacted preview, never the full secret
}

// A real 24+ char random secret draws on ~20-30 distinct characters. Synthetic
// test dummies are low-entropy: a single repeated char (`AAAA…`) or a short
// repeating block (`CQkJCQkJ…`, base64 of repeated 0x09 bytes) use very few.
function isLowEntropy(token: string): boolean {
  const core = token.replace(/=+$/, "");
  return new Set(core).size <= 6;
}

function isAllowed(token: string, lineLower: string): boolean {
  if (ALLOW_SUBSTRINGS.some((a) => lineLower.includes(a))) return true;
  if (token.startsWith("$") || token.includes("${")) return true; // env-var reference
  if (isLowEntropy(token)) return true;
  return false;
}

// A non-base64/hex assigned value looks like a real secret (vs. a placeholder
// word) when it is diverse AND has a digit AND is either special-char or
// mixed-case. `MyS3cur3P@ss!2024` → true; `replacemewithsomething` → false.
/**
 * A file/module path, not a secret.
 *
 * TOKEN_RE accepts `/`, so `src/lib/security/docSecrets` (27 chars) looked like
 * a base64 blob and tripped the scan on any doc line that also mentioned a
 * `*SECRET` identifier — a false positive that would recur constantly once the
 * scan was widened to source and workflow files (audit F-009).
 *
 * The discriminator is deliberately conservative: real base64 key material is
 * essentially always mixed with digits and/or `+`/`=` padding, so requiring the
 * ABSENCE of all of those before dismissing a slash-bearing token keeps the
 * detector strict. The burned-value pass runs before this and ignores every
 * guard, so a known-leaked secret is still caught even if it looks like a path.
 */
function looksLikePath(token: string): boolean {
  return token.includes("/") && !/\d/.test(token) && !/[+=]/.test(token);
}

function looksLikeAssignedSecret(token: string): boolean {
  if (token.length < 12) return false;
  if (new Set(token).size < 8) return false;
  if (!/\d/.test(token)) return false;
  return /[^A-Za-z0-9]/.test(token) || (/[a-z]/.test(token) && /[A-Z]/.test(token));
}

export function findSecretLeaks(
  text: string,
  burnedHashes: ReadonlySet<string> = BURNED_SECRET_HASHES
): Leak[] {
  const leaks: Leak[] = [];
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    // Burned-literal pass: a known-leaked value is flagged on ANY line —
    // no keyword required, allow-list bypassed (a burned value is never OK).
    for (const t of raw.match(TOKEN_RE) ?? []) {
      if (t.length >= 24 && isBurned(t, burnedHashes)) {
        leaks.push({ line: i + 1, keyword: "BURNED_SECRET", token: `${t.slice(0, 6)}…(${t.length} chars)` });
        return;
      }
    }
    const kw = raw.match(SECRET_KEYWORDS);
    if (!kw) return;
    const lower = raw.toLowerCase();
    const seen = new Set<string>();
    const push = (t: string) => {
      if (seen.has(t) || isAllowed(t, lower)) return;
      seen.add(t);
      leaks.push({ line: i + 1, keyword: kw![0], token: `${t.slice(0, 6)}…(${t.length} chars)` });
    };
    // 1. base64/hex high-entropy tokens (>=24 / >=32).
    for (const t of raw.match(TOKEN_RE) ?? []) if (t.length >= 24 && !looksLikePath(t)) push(t);
    // 2. special-character secrets assigned after the keyword (>=12, entropy-guarded).
    for (const m of raw.matchAll(ASSIGN_RE)) {
      const v = m[1];
      if (v && v.length < 24 && looksLikeAssignedSecret(v)) push(v);
    }
  });
  return leaks;
}

/**
 * Which tracked files the secret guard scans: shippable docs/config/env where a
 * real production secret could leak (`*.md`, `*.json`, `*.env*`). Internal
 * planning/spec artifacts under `docs/superpowers/` are excluded — they
 * legitimately contain illustrative secret-detection examples and are not a
 * deploy/runtime surface.
 */
/**
 * How the CLI enumerates candidate files.
 *
 * It lives here, beside the path filter, rather than in the script, so a test
 * can assert the invocation WITHOUT importing the CLI — whose module body runs
 * the scan and can call process.exit(1). `--others` is the flag that admits
 * uncommitted files, which is the case the scanner most needs to see;
 * `--exclude-standard` keeps .gitignore honoured so .env.local and build
 * output stay out.
 */
export const GIT_LIST_ARGS = ["ls-files", "--cached", "--others", "--exclude-standard"];

export function isScannableDocPath(path: string): boolean {
  const p = path.replace(/\\/g, "/");
  if (p.startsWith("docs/superpowers/")) return false;
  // The security modules and their tests legitimately contain secret-SHAPED
  // literals (the timing-equalizer hash, deny-list digests, malformed-hash
  // fixtures). They are scanned for BURNED values via findSecretLeaks'
  // keyword-independent path, but must not trip the generic entropy heuristic.
  if (/^src\/lib\/security\//.test(p)) return false;
  if (/\.test\.tsx?$/i.test(p)) return false;

  // Audit 2026-08-06 F-009: the scan used to cover only *.md / *.json / .env*,
  // so a credential pasted into a source file or a workflow — the likeliest
  // place for one to land — was never checked.
  return (
    /\.(md|json|ya?ml)$/i.test(p) ||
    /(^|\/)\.env/i.test(p) ||
    /^\.github\//.test(p) ||
    /^(src|scripts)\/.*\.(ts|tsx|mjs|cjs|js)$/i.test(p)
  );
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
