"use client";

import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";

/**
 * Topbar search field. Visual-only this sprint — matches the blueprint's
 * "Search players, teams, narratives…" affordance. Built on the shadcn Input.
 */
export function SearchInput() {
  return (
    <div className="relative w-[260px] max-w-[32vw]">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Search players, teams, narratives"
        placeholder="Search players, teams, narratives…"
        className="h-8 rounded-full pl-8 text-xs"
      />
    </div>
  );
}
