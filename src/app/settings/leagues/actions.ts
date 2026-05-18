"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { getDb } from "@/db";
import { createLeague, deleteLeagueForUser } from "@/lib/leagues";

const addLeagueSchema = z.object({
  platform: z.enum(["sleeper", "espn"]),
  externalLeagueId: z.string().min(1).max(64),
  season: z.coerce.number().int().min(2010).max(2099),
  label: z.string().min(1).max(80),
  espnS2: z.string().optional(),
  swid: z.string().optional()
});

export type AddLeagueResult = { ok: true; leagueId: string } | { ok: false; error: string };

export async function addLeague(formData: FormData): Promise<AddLeagueResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "unauthenticated" };

  const parsed = addLeagueSchema.safeParse({
    platform: formData.get("platform"),
    externalLeagueId: formData.get("externalLeagueId"),
    season: formData.get("season"),
    label: formData.get("label"),
    espnS2: formData.get("espnS2") ?? undefined,
    swid: formData.get("swid") ?? undefined
  });
  if (!parsed.success) return { ok: false, error: "Invalid form input" };

  const { platform, externalLeagueId, season, label, espnS2, swid } = parsed.data;
  if (platform === "espn" && (!espnS2 || !swid)) {
    return { ok: false, error: "ESPN leagues require both espn_s2 and SWID cookies" };
  }

  try {
    const league = await createLeague(getDb(), {
      userId,
      platform,
      externalLeagueId,
      season,
      label,
      credentials: platform === "espn" ? { espnS2: espnS2!, swid: swid! } : undefined
    });
    revalidatePath("/settings/leagues");
    return { ok: true, leagueId: league.id };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Failed to add league" };
  }
}

export async function removeLeague(leagueId: string): Promise<AddLeagueResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, error: "unauthenticated" };
  const deleted = await deleteLeagueForUser(getDb(), userId, leagueId);
  if (!deleted) return { ok: false, error: "not found" };
  revalidatePath("/settings/leagues");
  return { ok: true, leagueId };
}
