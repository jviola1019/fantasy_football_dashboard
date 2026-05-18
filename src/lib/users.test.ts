import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDbForTests, schema } from "../db";
import { authenticateUser, createUserWithPassword } from "./users";

describe("user accounts (hashed passwords)", () => {
  let db: ReturnType<typeof resetDbForTests>;

  beforeEach(() => {
    db = resetDbForTests();
  });

  it("creates a user with a hashed password (plaintext is never stored)", async () => {
    const user = await createUserWithPassword(db, {
      email: "alice@example.com",
      password: "correct horse battery staple"
    });
    expect(user.email).toBe("alice@example.com");

    const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    const passwordHash = rows[0]?.passwordHash ?? "";
    expect(passwordHash).toBeTruthy();
    expect(passwordHash).not.toContain("correct horse");
    expect(passwordHash.startsWith("scrypt1$")).toBe(true);
  });

  it("authenticates a user with correct password", async () => {
    await createUserWithPassword(db, {
      email: "alice@example.com",
      password: "correct horse battery staple"
    });
    const result = await authenticateUser(db, "alice@example.com", "correct horse battery staple");
    expect(result?.email).toBe("alice@example.com");
  });

  it("rejects wrong passwords", async () => {
    await createUserWithPassword(db, {
      email: "alice@example.com",
      password: "correct horse battery staple"
    });
    expect(await authenticateUser(db, "alice@example.com", "wrong")).toBeNull();
  });

  it("returns null for unknown email instead of leaking existence", async () => {
    expect(await authenticateUser(db, "ghost@example.com", "anything")).toBeNull();
  });

  it("normalizes email case", async () => {
    await createUserWithPassword(db, {
      email: "Alice@Example.com",
      password: "correct horse battery staple"
    });
    const result = await authenticateUser(db, "alice@example.com", "correct horse battery staple");
    expect(result).not.toBeNull();
  });

  it("rejects duplicate emails", async () => {
    await createUserWithPassword(db, { email: "a@a.com", password: "longenough123" });
    await expect(
      createUserWithPassword(db, { email: "a@a.com", password: "longenough123" })
    ).rejects.toThrow(/already exists/);
  });
});
