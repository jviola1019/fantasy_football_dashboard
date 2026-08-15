"use client";

import { z } from "zod";
import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Disable Zod's JIT schema compiler ON THE CLIENT (audit 2026-08-06 F-007).
 *
 * Zod v4 compiles schemas with `Function(...)` for speed and feature-detects
 * support by evaluating `Function("")` inside a try/catch. Under our CSP that
 * probe throws, Zod catches it and silently falls back to the interpreted path
 * — nothing breaks — but the browser still records a `script-src` violation,
 * which was the ONLY genuine violation left in the rollout sweep (on /trades).
 *
 * Since the JIT path could never succeed under a nonce-based CSP anyway, the
 * probe is pure waste plus a false alarm in the security evidence. `jitless`
 * skips it. This is set in a client-only module deliberately: the SERVER has no
 * CSP, so server-side validation keeps the JIT speedup.
 */
z.config({ jitless: true });

/**
 * Client-side providers mounted once at the app root:
 *  - SessionProvider — Auth.js session for `useSession()`.
 *  - TooltipProvider — shared delay/skip config for every shadcn tooltip
 *    (the sidebar's collapsed-rail labels rely on it).
 */
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
    </SessionProvider>
  );
}
