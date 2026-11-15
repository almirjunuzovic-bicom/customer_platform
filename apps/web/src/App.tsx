import { useState } from "react";
import { Login } from "@/components/Login";
import { SourcesAdmin } from "@/components/SourcesAdmin";
import { VpsList } from "@/components/VpsList";
import { Button } from "@/components/ui/button";
import { Toaster } from "@/components/ui/sonner";
import { useAuth } from "@/lib/auth-context";

type View = "vps" | "sources";

function App() {
  const { isAuthenticated, user, logout } = useAuth();
  const [view, setView] = useState<View>("vps");

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
        <div className="flex gap-2">
          <Button variant={view === "vps" ? "default" : "outline"} onClick={() => setView("vps")}>
            VPS
          </Button>
          <Button
            variant={view === "sources" ? "default" : "outline"}
            onClick={() => setView("sources")}
          >
            Sources
          </Button>
        </div>
        {view === "vps" ? <VpsList /> : <SourcesAdmin />}
      </div>
      <Toaster />
    </div>
  );
}

export default App;
