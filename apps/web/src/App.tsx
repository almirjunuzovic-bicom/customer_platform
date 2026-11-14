import { VpsList } from "@/components/VpsList";

function App() {
  return (
    <div className="min-h-svh bg-muted/30 p-8">
      <div className="mx-auto max-w-5xl space-y-6">
        <h1 className="text-2xl font-semibold">Hosting Platform</h1>
        <VpsList />
      </div>
    </div>
  );
}

export default App;
