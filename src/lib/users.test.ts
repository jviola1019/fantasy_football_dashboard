import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { resetDbForTests, schema } from "../db";
import {
  authenticateUser,
  changeUserPassword,
  createUserWithPassword,
  deleteUserWithPassword
} from "./users";

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

describe("changeUserPassword", () => {
  let db: ReturnType<typeof resetDbForTests>;

  beforeEach(() => {
    db = resetDbForTests();
  });

  it("rotates passwordHash when current password matches", async () => {
    const user = await createUserWithPassword(db, {
      email: "rotate@example.com",
      password: "originalpass"
    });
    const beforeHash = (
      await db.select().from(schema.users).where(eq(schema.users.id, user.id))
    )[0]!.passwordHash;

    const result = await changeUserPassword(db, user.id, "originalpass", "brand-new-password");
    expect(result).toEqual({ ok: true });

    // Old password no longer authenticates; new one does.
    expect(await authenticateUser(db, "rotate@example.com", "originalpass")).toBeNull();
    expect(
      await authenticateUser(db, "rotate@example.com", "brand-new-password")
    ).not.toBeNull();

    const afterHash = (
      await db.select().from(schema.users).where(eq(schema.users.id, user.id))
    )[0]!.passwordHash;
    expect(afterHash).not.toBe(beforeHash);
    expect(afterHash?.startsWith("scrypt1$")).toBe(true);
  });

  it("rejects with wrong-current-password when the current password is incorrect", async () => {
    const user = await createUserWithPassword(db, {
      email: "rotate@example.com",
      password: "originalpass"
    });
    const result = await changeUserPassword(db, user.id, "the-wrong-one", "brand-new-password");
    expect(result).toEqual({ ok: false, error: "wrong-current-password" });
    // Old password still works → mutation did not run.
    expect(await authenticateUser(db, "rotate@example.com", "originalpass")).not.toBeNull();
  });

  it("rejects new passwords shorter than 8 characters without verifying current", async () => {
    const user = await createUserWithPassword(db, {
      email: "rotate@example.com",
      password: "originalpass"
    });
    const result = await changeUserPassword(db, user.id, "originalpass", "short");
    expect(result).toEqual({ ok: false, error: "invalid-new-password" });
  });

  it("returns user-not-found for unknown user ids", async () => {
    const result = await changeUserPassword(db, "ghost-id", "anything", "longenoughpassword");
    expect(result).toEqual({ ok: false, error: "user-not-found" });
  });
});

describe("deleteUserWithPassword", () => {
  let db: ReturnType<typeof resetDbForTests>;

  beforeEach(() => {
    db = resetDbForTests();
  });

  it("deletes the user when the password matches", async () => {
    const user = await createUserWithPassword(db, {
      email: "delete-me@example.com",
      password: "topsecret"
    });
    const result = await deleteUserWithPassword(db, user.id, "topsecret");
    expect(result).toEqual({ ok: true });

    const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(rows.length).toBe(0);
  });

  it("rejects with wrong-password and does not delete when the password is wrong", async () => {
    const user = await createUserWithPassword(db, {
      email: "delete-me@example.com",
      password: "topsecret"
    });
    const result = await deleteUserWithPassword(db, user.id, "not-the-password");
    expect(result).toEqual({ ok: false, error: "wrong-password" });

    const rows = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
    expect(rows.length).toBe(1);
  });

  it("returns user-not-found for unknown user ids", async () => {
    const result = await deleteUserWithPassword(db, "ghost-id", "anything");
    expect(result).toEqual({ ok: false, error: "user-not-found" });
  });
});
