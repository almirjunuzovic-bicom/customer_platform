import { useQuery } from "@tanstack/react-query";
import { api, type VpsInventory } from "@/lib/api";
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

function StateBadge({ state }: { state: string | null }) {
  if (state === "RUNNING") return <Badge>RUNNING</Badge>;
  if (state === "STOPPED") return <Badge variant="outline">STOPPED</Badge>;
  return <Badge variant="destructive">{state ?? "UNKNOWN"}</Badge>;
}

function VpsRow({ vps }: { vps: VpsInventory }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{vps.name}</TableCell>
      <TableCell>
        <StateBadge state={vps.lastKnownState} />
      </TableCell>
      <TableCell>{vps.engine ?? "—"}</TableCell>
      <TableCell>{vps.memLimit ? `${vps.memLimit} MB` : "—"}</TableCell>
      <TableCell>{vps.cpuLimit || "—"}</TableCell>
      <TableCell className="text-muted-foreground">
        {(vps.ipAddresses ?? []).join(", ") || "—"}
      </TableCell>
    </TableRow>
  );
}

export function VpsList() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["vps"],
    queryFn: api.vpsList,
    refetchInterval: 10_000, // matches the poller's own tick, see hst2171-architecture
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>VPS Instances</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {isError && (
          <p className="text-destructive">
            Failed to load VPS list: {(error as Error).message}
          </p>
        )}
        {data && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Engine</TableHead>
                <TableHead>Memory</TableHead>
                <TableHead>CPU</TableHead>
                <TableHead>IP Addresses</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((vps) => (
                <VpsRow key={vps.id} vps={vps} />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
