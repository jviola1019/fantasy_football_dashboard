"use client";

import { signOut, useSession } from "next-auth/react";
import { useTransition } from "react";
import { LogOut, User, Trophy, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu";

/**
 * Topbar account widget.
 *  - Skeleton while the session resolves.
 *  - A "Sign in" button when unauthenticated.
 *  - Avatar + email + dropdown (My leagues / Sign out) when authenticated.
 * Built on shadcn DropdownMenu + Button.
 */
export function UserMenu() {
  const { data: session, status } = useSession();
  const [pending, startTransition] = useTransition();

  if (status === "loading") {
    return <Skeleton className="h-8 w-[120px] rounded-full" />;
  }

  if (!session?.user) {
    // Anonymous viewers get a Mock-Draft shortcut alongside Sign In —
    // it's a useful entry point that doesn't require an account.
    return (
      <div className="flex items-center gap-2">
        <Button asChild size="sm" variant="ghost">
          <a href="/mock-draft">Mock draft</a>
        </Button>
        <Button asChild size="sm" variant="outline">
          <a href="/login">Sign in</a>
        </Button>
      </div>
    );
  }

  const email = session.user.email ?? "";
  const initials = (session.user.name ?? email)
    .split(/[\s@]+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          // On mobile the email span is hidden, leaving bare initials as the
          // accessible name — so name the control explicitly (audit F-11).
          aria-label={`Account menu for ${email}`}
          className="flex items-center gap-2 rounded-full border border-border bg-card/60 py-1 pl-1 pr-3 text-xs text-foreground transition-colors hover:border-ring/50"
        >
          <span className="grid size-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-rae-blue to-rae-purple text-xs font-bold text-background">
            {initials || "?"}
          </span>
          <span className="hidden max-w-[170px] truncate text-muted-foreground sm:inline">
            {email}
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuLabel className="truncate font-normal text-muted-foreground">
          {email}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <a href="/settings/leagues">
            <User />
            My leagues
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/mock-draft">
            <Trophy />
            Mock draft
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <a href="/settings/account">
            <Settings />
            Account settings
          </a>
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          disabled={pending}
          onSelect={(e) => {
            e.preventDefault();
            startTransition(async () => {
              await signOut({ redirect: true, redirectTo: "/" });
            });
          }}
        >
          <LogOut />
          {pending ? "Signing out…" : "Sign out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
