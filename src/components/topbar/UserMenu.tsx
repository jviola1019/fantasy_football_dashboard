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
    return <Skeleton className="h-8 w-[120px] rounded-[3px]" />;
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
          className="flex items-center gap-2 rounded-[4px] border border-border bg-card py-1 pl-1 pr-3 text-xs text-foreground transition-colors hover:border-ring/50"
        >
          {/* A monogram tile, not a gradient orb. `rounded-full` over a
              blue-to-purple gradient is the single most recognisable mark of a
              generated app, and purple is not a RAE colour: `--purple` exists
              for ONE data encoding (the volatility legend) and this was the
              only decorative use of it in the product. Square tile, flat
              surface, hairline border, same radius as every other chip. */}
          <span className="grid size-8 shrink-0 place-items-center rounded-[3px] border border-rae-blue/40 bg-rae-blue/15 text-xs font-bold text-foreground">
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
              // `redirect: false`, then navigate here — the same shape as the
              // sign-in fix, for the same reason. Auth.js resolves its own
              // redirect against AUTH_URL, not the request origin, so
              // `redirectTo: "/"` on a Vercel preview navigated the browser to
              // PRODUCTION's home page. Measured: the signout endpoint returned
              // `{"url":"https://pretend-production.example.com/..."}` while
              // being served from localhost. A relative assign is same-origin by
              // construction.
              await signOut({ redirect: false });
              // A client navigation would leave SessionProvider holding the
              // session it just discarded, so the topbar would keep naming an
              // account nobody is signed into -- the sign-in bug in reverse.
              // Suppressed with the reason rather than dodged by hiding the
              // destination from the rule behind a constant.
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full reload is required to rebuild the auth provider
              window.location.assign("/");
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
