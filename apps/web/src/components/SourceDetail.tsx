import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import { api } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { SyncStatus } from "@/components/SyncStatus";
import { VpsList } from "@/components/VpsList";

export function SourceDetail() {
  const { sourceId } = useParams({ from: "/sources/$sourceId" });
  const id = Number(sourceId);

  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: api.sources,
    refetchInterval: 10_000,
  });
  const hostsQuery = useQuery({ queryKey: ["hosts"], queryFn: api.hosts, refetchInterval: 10_000 });
  const partitionsQuery = useQuery({ queryKey: ["partitions"], queryFn: api.partitions });

  const source = sourcesQuery.data?.find((s) => s.id === id);
  const hosts = (hostsQuery.data ?? []).filter((h) => h.sourceId === id);
  const partitions = (partitionsQuery.data ?? []).filter((p) => p.sourceId === id);
  const config = source?.config ?? {};

  if (sourcesQuery.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }
  if (!source) {
    return <p className="text-destructive">No source with id {id}.</p>;
  }

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Back to infrastructure
        </Link>
      </div>

      <div className="flex items-center gap-3">
        <h2 className="text-xl font-semibold">{source.name}</h2>
        <Badge variant="secondary">{source.connectorType}</Badge>
        <Badge variant={source.enabled ? "secondary" : "destructive"}>
          {source.enabled ? "enabled" : "disabled"}
        </Badge>
        <SyncStatus source={source} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Hosts</CardTitle>
        </CardHeader>
        <CardContent>
          {hosts.length === 0 && (
            <p className="text-sm text-muted-foreground">No hosts synced for this source yet.</p>
          )}
          {hosts.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Purpose</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>CPU</TableHead>
                  <TableHead>Memory</TableHead>
                  <TableHead>VPS (running/total)</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hosts.map((host) => (
                  <TableRow key={host.id}>
                    <TableCell className="font-medium">{host.name}</TableCell>
                    <TableCell>{host.purpose ?? "—"}</TableCell>
                    <TableCell>
                      <Badge variant={host.online ? "default" : "destructive"}>
                        {host.state ?? (host.online ? "online" : "offline")}
                      </Badge>
                    </TableCell>
                    <TableCell>{host.cpuUsage != null ? `${host.cpuUsage.toFixed(1)}%` : "—"}</TableCell>
                    <TableCell>
                      {host.memUsage != null && host.memTotal
                        ? `${host.memUsage.toFixed(1)}% of ${Math.round(host.memTotal / 1024)} GB`
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {host.vpsRunning ?? "—"}/{host.vpsCount ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Partitions (customers)</CardTitle>
        </CardHeader>
        <CardContent>
          {partitions.length === 0 && (
            <p className="text-sm text-muted-foreground">No partitions synced for this source yet.</p>
          )}
          {partitions.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Customer ID</TableHead>
                  <TableHead>VPS quota</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partitions.map((partition) => (
                  <TableRow key={partition.id}>
                    <TableCell className="font-medium">{partition.name}</TableCell>
                    <TableCell>{partition.company ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {partition.customerId ?? "—"}
                    </TableCell>
                    <TableCell>
                      {partition.vpsUsage ?? "—"}/{partition.vpsQuota ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <VpsList sourceId={id} title="VPS instances" />

      {typeof config.baseUrl === "string" && (
        <p className="text-xs text-muted-foreground">Base URL: {config.baseUrl}</p>
      )}
    </div>
  );
}
