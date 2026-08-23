import { createHash } from "node:crypto";
import { describe, it, expect } from "vitest";
import { BURNED_SECRET_HASHES, findSecretLeaks, scanFiles, isScannableDocPath } from "./docSecrets";

/**
 * Fixtures are ASSEMBLED AT RUNTIME, never written as literals (audit P1 §7).
 *
 * These strings were always synthetic, and the comments beside them always said
 * so — but Gitleaks cannot read comments. It scans full history, flagged them,
 * and turned the repository's Security workflow permanently red, burying any
 * genuine future finding in known noise. A scanner nobody believes is worse
 * than no scanner at all.
 *
 * Deriving each from a SHA-256 of a fixed seed keeps every property these tests
 * depend on — deterministic, high-entropy, exact length and shape — while
 * leaving no secret-shaped literal in a tracked file for any scanner to trip
 * over. That removes the false positive at its source rather than suppressing
 * it, so only immutable git history still needs an exception.
 */
function synthetic(seed: string, length: number): string {
  let out = "";
  for (let i = 0; out.length < length; i += 1) {
    out += createHash("sha256").update(`${seed}:${i}`).digest("base64").replace(/[^A-Za-z0-9]/g, "");
  }
  return out.slice(0, length);
}

describe("isScannableDocPath", () => {
  it("scans shippable docs/config/env", () => {
    expect(isScannableDocPath("DEPLOY_TO_VERCEL.md")).toBe(true);
    expect(isScannableDocPath("reports/playwright.json")).toBe(true);
    expect(isScannableDocPath(".env.example")).toBe(true);
  });

  it("also scans source and workflows (audit F-009 widened the scope)", () => {
    // Previously only *.md / *.json / .env* were scanned, so a credential
    // pasted into a source file or a CI workflow was never checked — which is
    // the likeliest place for one to actually land.
    expect(isScannableDocPath("src/lib/foo.ts")).toBe(true);
    expect(isScannableDocPath("src/app/api/health/route.ts")).toBe(true);
    expect(isScannableDocPath("scripts/smoke-vercel.ts")).toBe(true);
    expect(isScannableDocPath(".github/workflows/ci.yml")).toBe(true);
  });

  it("excludes the security modules and tests, which hold secret-SHAPED fixtures", () => {
    expect(isScannableDocPath("src/lib/security/docSecrets.ts")).toBe(false);
    expect(isScannableDocPath("src/lib/users.test.ts")).toBe(false);
  });

  it("does not flag a file path as a secret", () => {
    // Regression: `src/lib/security/docSecrets` is 27 chars and matches the
    // base64 token pattern, so any line mentioning a *SECRET identifier
    // alongside a path used to fail the scan.
    const leaks = findSecretLeaks("see BURNED_SECRET_HASHES in src/lib/security/docSecrets for detail");
    expect(leaks).toEqual([]);
  });

  it("still flags a real base64 secret on a keyworded line", () => {
    const leaks = findSecretLeaks(`AUTH_SECRET=${synthetic("inline-b64", 43)}=`);
    expect(leaks.length).toBeGreaterThan(0);
  });

  it("excludes internal planning artifacts under docs/superpowers/", () => {
    expect(isScannableDocPath("docs/superpowers/plans/2026-06-09-x.md")).toBe(false);
    expect(isScannableDocPath("docs/superpowers/specs/y.md")).toBe(false);
  });
});

const FAKE_B64 = `${synthetic("b64", 43)}=`; // 44-char base64 shape
const FAKE_TOKEN = synthetic("token", 32); // 32-char alnum shape
const FAKE_HYPHEN = `ab1-cd2-${synthetic("hyphen", 27)}`; // hyphen-prefixed shape

describe("findSecretLeaks", () => {
  it("flags a base64 secret next to a keyword (markdown table row)", () => {
    const text = `| \`AUTH_SECRET\` | \`${FAKE_B64}\` |`;
    expect(findSecretLeaks(text)).toHaveLength(1);
  });

  it("flags a token in a curl header", () => {
    const text = `curl -H "x-init-token: ${FAKE_TOKEN}"`;
    expect(findSecretLeaks(text)).toHaveLength(1);
  });

  it("passes placeholder values", () => {
    const text = "| `AUTH_SECRET` | `your-32-byte-base64-secret-here` |";
    expect(findSecretLeaks(text)).toHaveLength(0);
  });

  it("passes short redacted prefixes used in audit reports", () => {
    const text = "AUTH_SECRET (`Qp7Lm2Xv…`) — NextAuth JWT signing key";
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

  it("ignores a low-entropy repeating-block dummy (playwright test key)", () => {
    const text = '"CREDENTIAL_ENCRYPTION_KEY": "CQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQk="';
    expect(findSecretLeaks(text)).toHaveLength(0);
  });

  it("flags a hyphen-prefixed CRON_SECRET in a markdown note", () => {
    const text = `| \`CRON_SECRET\` | set to \`${FAKE_HYPHEN}\` — rotate |`;
    expect(findSecretLeaks(text)).toHaveLength(1);
  });

  it("flags a special-character password assigned after the keyword (Issue 2)", () => {
    expect(findSecretLeaks("DB_PASSWORD=MyS3cur3P@ss!2024")).toHaveLength(1);
    expect(findSecretLeaks(`PASSWORD: "${synthetic("password", 17)}"`)).toHaveLength(1);
  });

  it("does NOT flag .env.example placeholders or env-var references", () => {
    expect(findSecretLeaks("AUTH_SECRET=replace_me_with_openssl_rand_base64_32")).toHaveLength(0);
    expect(findSecretLeaks("CREDENTIAL_ENCRYPTION_KEY=")).toHaveLength(0);
    expect(findSecretLeaks("CRON_SECRET=")).toHaveLength(0);
    expect(findSecretLeaks("# Vercel sets `Authorization: Bearer $CRON_SECRET`")).toHaveLength(0);
    expect(findSecretLeaks("DB_PASSWORD: ${{ secrets.DB_PASSWORD }}")).toHaveLength(0);
  });
});

describe("burned-secret deny-list (audit 2026-07-08 A-01)", () => {
  // Synthetic stand-in for a leaked value; the real deny-list stores only
  // SHA-256 digests so no test or source file ever contains a burned plaintext.
  const FAKE_BURNED = `${synthetic("burned", 43)}=`;
  const fakeHash = createHash("sha256").update(FAKE_BURNED).digest("hex");

  it("flags a burned literal even with NO secret keyword on the line", () => {
    const leaks = findSecretLeaks(`random note: ${FAKE_BURNED}`, new Set([fakeHash]));
    expect(leaks).toHaveLength(1);
    expect(leaks[0]!.keyword).toBe("BURNED_SECRET");
    expect(leaks[0]!.token).not.toContain(FAKE_BURNED);
  });

  it("flags a burned literal even when the line matches the allow-list", () => {
    // "example" is on ALLOW_SUBSTRINGS — a burned value must still be caught.
    const leaks = findSecretLeaks(`example config: ${FAKE_BURNED}`, new Set([fakeHash]));
    expect(leaks).toHaveLength(1);
  });

  it("ships the three 2026-05 history-leak digests by default", () => {
    expect(BURNED_SECRET_HASHES.size).toBe(6);
    for (const h of BURNED_SECRET_HASHES) expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("scanFiles", () => {
  it("aggregates leaks per file using an injected reader", () => {
    const read = (p: string) =>
      p === "bad.md" ? `DB_INIT_TOKEN = ${FAKE_TOKEN}` : "nothing secret here";
    const res = scanFiles(["bad.md", "good.md"], read);
    expect(Object.keys(res)).toEqual(["bad.md"]);
    expect(res["bad.md"]).toHaveLength(1);
  });
});
