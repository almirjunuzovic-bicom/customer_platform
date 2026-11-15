import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { Button, buttonVariants } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
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
          <h1 className="text-2xl font-semibold">Hosting Platform</h1>
          <div className="flex items-center gap-3">
            {user && <span className="text-sm text-muted-foreground">{user.email}</span>}
            <Button variant="outline" onClick={logout}>
              Sign out
            </Button>
          </div>
        </div>
        <div className="flex gap-2">
          <NavLink to="/">Topology</NavLink>
          <NavLink to="/vps">VPS</NavLink>
          <NavLink to="/sources">Sources</NavLink>
        </div>
        <Outlet />
      </div>
      <Toaster />
    </div>
  );
}
