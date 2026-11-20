import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isActive = to === "/" ? pathname === "/" : pathname.startsWith(to);
  return (
    <Link to={to} className={cn(buttonVariants({ variant: isActive ? "default" : "outline" }))}>
      {children}
    </Link>
  );
}

export function AppLayout() {
  const { user, logout } = useAuth();

  return (
    <div className="min-h-svh bg-muted/30 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/bicom-logo.png" alt="Bicom Systems" className="h-6 w-auto" />
            <span className="h-6 w-px bg-border" />
            <h1 className="text-2xl font-semibold">Hosting Platform</h1>
          </div>
          <div className="flex items-center gap-3">
            {user && <span className="text-sm text-muted-foreground">{user.email}</span>}
            <ThemeToggle />
            <Button variant="outline" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <NavLink to="/">Topology</NavLink>
          <NavLink to="/vps">All VPSes</NavLink>
          <NavLink to="/events">Events</NavLink>
          <NavLink to="/sources">Sources</NavLink>
          <NavLink to="/dev">Dev</NavLink>
        </div>
        <Outlet />
        <footer className="mt-4 flex items-center justify-center gap-2 border-t pt-6 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} Bicom Systems. All rights reserved.</span>
          <span aria-hidden>·</span>
          <a
            href="https://www.bicomsystems.com"
            target="_blank"
            rel="noreferrer"
            className="hover:text-foreground"
          >
            bicomsystems.com
          </a>
        </footer>
      </div>
      <Toaster />
    </div>
  );
}
