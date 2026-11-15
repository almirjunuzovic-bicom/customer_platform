import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { PhoneCall, Server, Users } from "lucide-react";
import { api, type Host, type Partition, type Source, type VpsInventory } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { SyncStatus } from "@/components/SyncStatus";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="text-center">
      <p className="text-lg font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function UsageBar({ label, usedGb, totalGb }: { label: string; usedGb: number; totalGb: number }) {
  const pct = totalGb > 0 ? Math.min(100, (usedGb / totalGb) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="tabular-nums text-muted-foreground">
          {Math.round(usedGb)} / {Math.round(totalGb)} GB
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SourceCard({
  source,
  vps,
  hosts,
  partitions,
}: {
  source: Source;
  vps: VpsInventory[];
  hosts: Host[];
  partitions: Partition[];
}) {
  const running = vps.filter((v) => v.lastKnownState === "RUNNING").length;
  const onlineHosts = hosts.filter((h) => h.online).length;
  // Cluster-wide "how's it doing" summary - ServerWare/PBXware-specific
  // (connector.types.ts SourceOverview), so a non-serverware source 502s
  // here and this section just doesn't render (see isSuccess guard below).
  const overviewQuery = useQuery({
    queryKey: ["sources", source.id, "overview"],
    queryFn: () => api.sourceOverview(source.id),
    refetchInterval: 10_000,
    retry: false,
  });
  const overview = overviewQuery.data;

  return (
    <Link to="/sources/$sourceId" params={{ sourceId: String(source.id) }}>
      <Card className="h-full transition-colors hover:border-foreground/20">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Server className="size-4 text-muted-foreground" />
              <CardTitle>{source.name}</CardTitle>
            </div>
            <Badge variant={source.enabled ? "secondary" : "destructive"}>
              {source.enabled ? source.connectorType : "disabled"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">{source.key}</p>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-4 gap-2">
            <Stat label="VPS" value={vps.length} />
            <Stat label="Running" value={running} />
            <Stat label="Hosts" value={`${onlineHosts}/${hosts.length}`} />
            <Stat label="Partitions" value={partitions.length} />
          </div>

          {overview && (
            <>
              <div className="space-y-2">
                <UsageBar label="Memory" usedGb={overview.memCommittedGb} totalGb={overview.memTotalGb} />
                <UsageBar
                  label="Storage"
                  usedGb={overview.storageCommittedGb}
                  totalGb={overview.storageTotalGb}
                />
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="size-3.5" />
                  {overview.activeUsers} active users
                </span>
                <span className="flex items-center gap-1">
                  <PhoneCall className="size-3.5" />
                  {overview.concurrentCalls} calls now
                </span>
              </div>
            </>
          )}

          <SyncStatus source={source} />
        </CardContent>
      </Card>
    </Link>
  );
}

export function Topology() {
  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: api.sources,
    refetchInterval: 10_000,
  });
  const vpsQuery = useQuery({
    queryKey: ["vps", "all"],
    queryFn: () => api.vpsList(),
    refetchInterval: 10_000,
  });
  const hostsQuery = useQuery({ queryKey: ["hosts"], queryFn: api.hosts, refetchInterval: 10_000 });
  const partitionsQuery = useQuery({ queryKey: ["partitions"], queryFn: api.partitions });

  const isLoading =
    sourcesQuery.isLoading || vpsQuery.isLoading || hostsQuery.isLoading || partitionsQuery.isLoading;

  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Infrastructure</h2>
      {isLoading && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-40 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      )}
      {sourcesQuery.isError && (
        <p className="text-destructive">
          Failed to load sources: {(sourcesQuery.error as Error).message}
        </p>
      )}
      {sourcesQuery.data && sourcesQuery.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No sources configured yet - add one on the Sources page.
        </p>
      )}
      {sourcesQuery.data && sourcesQuery.data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sourcesQuery.data.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              vps={(vpsQuery.data ?? []).filter((v) => v.sourceId === source.id)}
              hosts={(hostsQuery.data ?? []).filter((h) => h.sourceId === source.id)}
              partitions={(partitionsQuery.data ?? []).filter((p) => p.sourceId === source.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
