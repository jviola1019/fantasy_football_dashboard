"use server";

import { z } from "zod";
import { signIn } from "@/lib/auth";
import { getDb } from "@/db";
import { createUserWithPassword } from "@/lib/users";

const inputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().optional()
});

export type AuthActionResult = { ok: true } | { ok: false; error: string };

export async function signInWithCredentials(formData: FormData): Promise<AuthActionResult> {
  const parsed = inputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });
  if (!parsed.success) return { ok: false, error: "Invalid email or password format" };
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Sign-in failed" };
  }
}

export async function registerWithCredentials(formData: FormData): Promise<AuthActionResult> {
  const parsed = inputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name") ?? undefined
  });
  if (!parsed.success) return { ok: false, error: "Email must be valid; password must be 8+ characters" };
  try {
    await createUserWithPassword(getDb(), parsed.data);
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirect: false
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Registration failed" };
  }
}
