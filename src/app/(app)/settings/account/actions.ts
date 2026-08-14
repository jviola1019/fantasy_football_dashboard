"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { signOut } from "@/lib/auth";
import { requireUser } from "@/lib/auth/requireUser";
import { getDb } from "@/db";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/passwords";
import { changeUserPassword, deleteUserWithPassword } from "@/lib/users";

export type AccountActionResult = { ok: true } | { ok: false; error: string };

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH),
  confirmPassword: z.string().min(MIN_PASSWORD_LENGTH).max(MAX_PASSWORD_LENGTH)
});

export async function changePasswordAction(formData: FormData): Promise<AccountActionResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const userId = user.id;

  const parsed = changePasswordSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    newPassword: formData.get("newPassword"),
    confirmPassword: formData.get("confirmPassword")
  });
  if (!parsed.success) {
    return { ok: false, error: "New password must be 8+ characters." };
  }
  if (parsed.data.newPassword !== parsed.data.confirmPassword) {
    return { ok: false, error: "New password and confirmation do not match." };
  }

  const result = await changeUserPassword(
    getDb(),
    userId,
    parsed.data.currentPassword,
    parsed.data.newPassword
  );
  if (!result.ok) {
    if (result.error === "wrong-current-password") {
      return { ok: false, error: "Current password is incorrect." };
    }
    if (result.error === "invalid-new-password") {
      return { ok: false, error: "New password must be 8+ characters." };
    }
    return { ok: false, error: "Could not update password." };
  }

  revalidatePath("/settings/account");
  return { ok: true };
}

const deleteAccountSchema = z.object({
  currentPassword: z.string().min(1).max(MAX_PASSWORD_LENGTH),
  confirm: z.string().max(64)
});

export async function deleteAccountAction(formData: FormData): Promise<AccountActionResult> {
  const user = await requireUser();
  if (!user) return { ok: false, error: "unauthenticated" };
  const userId = user.id;

  const parsed = deleteAccountSchema.safeParse({
    currentPassword: formData.get("currentPassword"),
    confirm: formData.get("confirm")
  });
  if (!parsed.success) return { ok: false, error: "Missing fields." };
  // Require the user to type DELETE so a misclick on the form can't drop the
  // account — pairs with the password requirement for defense in depth.
  if (parsed.data.confirm.trim().toUpperCase() !== "DELETE") {
    return { ok: false, error: "Type DELETE to confirm." };
  }

  const result = await deleteUserWithPassword(getDb(), userId, parsed.data.currentPassword);
  if (!result.ok) {
    if (result.error === "wrong-password") return { ok: false, error: "Password is incorrect." };
    return { ok: false, error: "Could not delete account." };
  }

  // Drop the JWT cookie and bounce home. signOut returns void; the redirect
  // is what actually shows the user that the account is gone.
  await signOut({ redirect: false });
  redirect("/");
}
