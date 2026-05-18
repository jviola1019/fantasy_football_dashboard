import { eq } from "drizzle-orm";
import { schema } from "../db";
import { hashPassword, verifyPassword } from "./passwords";

type Db = ReturnType<typeof import("../db").getDb>;

export interface CreateUserInput {
  email: string;
  password: string;
  name?: string;
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string | null;
}

export async function createUserWithPassword(db: Db, input: CreateUserInput): Promise<AuthenticatedUser> {
  const email = input.email.trim().toLowerCase();
  if (!email.includes("@")) throw new Error("invalid email");
  const existing = await db.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
  if (existing[0]) throw new Error("user already exists");
  const passwordHash = await hashPassword(input.password);
  const inserted = await db
    .insert(schema.users)
    .values({ email, name: input.name ?? null, passwordHash })
    .returning();
  const row = inserted[0]!;
  return { id: row.id, email: row.email!, name: row.name };
}

export async function authenticateUser(db: Db, email: string, password: string): Promise<AuthenticatedUser | null> {
  const normalized = email.trim().toLowerCase();
  const rows = await db.select().from(schema.users).where(eq(schema.users.email, normalized)).limit(1);
  const row = rows[0];
  if (!row || !row.passwordHash) return null;
  const ok = await verifyPassword(password, row.passwordHash);
  if (!ok) return null;
  return { id: row.id, email: row.email!, name: row.name };
}
