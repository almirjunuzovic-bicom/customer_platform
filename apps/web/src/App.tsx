import { Login } from "@/components/Login";
import { VpsList } from "@/components/VpsList";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

function App() {
  const { isAuthenticated, user, logout } = useAuth();

  if (!isAuthenticated) {
    return <Login />;
  }

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
        <VpsList />
      </div>
    </div>
  );
}

export default App;
