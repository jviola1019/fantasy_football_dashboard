"use server";

import { isRedirectError } from "next/dist/client/components/redirect-error";
import { z } from "zod";
import { signIn } from "@/lib/auth";
import { getDb } from "@/db";
import { createUserWithPassword } from "@/lib/users";
import { mapAuthError } from "@/lib/auth/errors";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/passwords";

// Bounds matter here, not just minimums: scrypt hashes the whole input, so an
// unbounded password on a public endpoint is a CPU/memory amplifier (audit
// F-005). Email and name are capped for the same reason.
const inputSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  name: z.string().max(200).optional()
});

export type AuthActionResult = { ok: true } | { ok: false; error: string };

const DEFAULT_REDIRECT = "/settings/leagues";

export async function signInWithCredentials(formData: FormData): Promise<AuthActionResult> {
  const parsed = inputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password")
  });
  if (!parsed.success) return { ok: false, error: "Enter a valid email and an 8+ character password." };
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: DEFAULT_REDIRECT
    });
    return { ok: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { ok: false, error: mapAuthError(error) };
  }
}

export async function registerWithCredentials(formData: FormData): Promise<AuthActionResult> {
  const parsed = inputSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    name: formData.get("name") ?? undefined
  });
  if (!parsed.success) return { ok: false, error: "Enter a valid email and an 8+ character password." };
  try {
    await createUserWithPassword(getDb(), parsed.data);
  } catch (error) {
    return { ok: false, error: mapAuthError(error) };
  }
  try {
    await signIn("credentials", {
      email: parsed.data.email,
      password: parsed.data.password,
      redirectTo: DEFAULT_REDIRECT
    });
    return { ok: true };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    return { ok: false, error: mapAuthError(error) };
  }
}
