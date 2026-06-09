import { describe, it, expect } from "vitest";
import { findSecretLeaks, scanFiles } from "./docSecrets";

describe("findSecretLeaks", () => {
  it("flags a real base64 secret next to a keyword (markdown table row)", () => {
    const text = "| `AUTH_SECRET` | `LgWf0D/pjkYINQyijrdCtkpkB0tipxz1eHczmiWA514=` |";
    expect(findSecretLeaks(text)).toHaveLength(1);
  });

  it("flags a token in a curl header", () => {
    const text = 'curl -H "x-init-token: KiqQvPMfgcl22U0cpYX5RXoc9znt2NCJ"';
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
        ? "DB_INIT_TOKEN = KiqQvPMfgcl22U0cpYX5RXoc9znt2NCJ"
        : "nothing secret here";
    const res = scanFiles(["bad.md", "good.md"], read);
    expect(Object.keys(res)).toEqual(["bad.md"]);
    expect(res["bad.md"]).toHaveLength(1);
  });
});
