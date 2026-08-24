/**
 * Where a successful sign-in lands.
 *
 * Its own module because `actions.ts` is a `"use server"` file and those may
 * only export async functions. Both the action and the form import from here,
 * so the destination lives in ONE place -- it was duplicated as a literal in
 * both for a while, which is how two copies quietly disagree.
 */
export const DEFAULT_REDIRECT = "/settings/leagues";
