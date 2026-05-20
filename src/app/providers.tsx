"use client";

import { SessionProvider } from "next-auth/react";
import { TooltipProvider } from "@/components/ui/tooltip";

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
