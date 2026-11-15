import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, UnauthorizedError, type VpsInventory } from "@/lib/api";
import { useAuth } from "@/lib/auth-context";
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
import { VpsActions } from "@/components/VpsActions";

function StateBadge({ state, task }: { state: string | null; task: string | null }) {
  const badge =
    state === "RUNNING" ? (
      <Badge>RUNNING</Badge>
    ) : state === "STOPPED" ? (
      <Badge variant="outline">STOPPED</Badge>
    ) : (
      <Badge variant="destructive">{state ?? "UNKNOWN"}</Badge>
    );
  return (
    <div className="flex items-center gap-1.5">
      {badge}
      {task && (
        <Badge variant="secondary" title={`SERVERware task: ${task}`}>
          {task}
        </Badge>
      )}
    </div>
  );
}

function VpsRow({ vps }: { vps: VpsInventory }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{vps.name}</TableCell>
      <TableCell>
        <StateBadge state={vps.lastKnownState} task={vps.task} />
      </TableCell>
      <TableCell>{vps.engine ?? "—"}</TableCell>
      <TableCell>{vps.memLimit ? `${vps.memLimit} MB` : "—"}</TableCell>
      <TableCell>{vps.cpuLimit || "—"}</TableCell>
      <TableCell className="text-muted-foreground">
        {(vps.ipAddresses ?? []).join(", ") || "—"}
      </TableCell>
      <TableCell>
        <VpsActions
          vpsId={vps.id}
          vpsName={vps.name}
          state={vps.lastKnownState}
          task={vps.task}
          pendingAction={vps.pendingAction}
        />
      </TableCell>
    </TableRow>
  );
}

export function VpsList() {
  const { logout } = useAuth();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["vps"],
    queryFn: api.vpsList,
    refetchInterval: 10_000, // matches the poller's own tick, see hst2171-architecture
    retry: (failureCount, err) => !(err instanceof UnauthorizedError) && failureCount < 3,
  });

  useEffect(() => {
    if (error instanceof UnauthorizedError) logout();
  }, [error, logout]);

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
                <TableHead>Actions</TableHead>
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
