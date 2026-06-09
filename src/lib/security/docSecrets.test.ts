import { describe, it, expect } from "vitest";
import { findSecretLeaks, scanFiles, isScannableDocPath } from "./docSecrets";

describe("isScannableDocPath", () => {
  it("scans shippable docs/config/env", () => {
    expect(isScannableDocPath("DEPLOY_TO_VERCEL.md")).toBe(true);
    expect(isScannableDocPath("reports/playwright.json")).toBe(true);
    expect(isScannableDocPath(".env.example")).toBe(true);
    expect(isScannableDocPath("src/lib/foo.ts")).toBe(false);
  });

  it("excludes internal planning artifacts under docs/superpowers/", () => {
    expect(isScannableDocPath("docs/superpowers/plans/2026-06-09-x.md")).toBe(false);
    expect(isScannableDocPath("docs/superpowers/specs/y.md")).toBe(false);
  });
});

// All fixtures below are SYNTHETIC high-entropy strings — never real secrets.
const FAKE_B64 = "Qp7Lm2Xv9Rt4Wy6Zb8Nc1Df3Gh5Jk0Ab2Cd4Ef6Hj8="; // 44-char base64 shape
const FAKE_TOKEN = "Qp7Lm2Xv9Rt4Wy6Zb8Nc1Df3Gh5Jk0A"; // 32-char alnum shape
const FAKE_HYPHEN = "ab1-cd2-Qp7Lm2Xv9Rt4Wy6Zb8Nc1Df3Gh5"; // hyphen-prefixed shape

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
