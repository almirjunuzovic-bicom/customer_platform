import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
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
import { StateBadge } from "@/components/StateBadge";
import { VpsActions } from "@/components/VpsActions";

function VpsRow({ vps }: { vps: VpsInventory }) {
  return (
    <TableRow>
      <TableCell className="font-medium">
        <Link
          to="/vps/$vpsId"
          params={{ vpsId: String(vps.id) }}
          className="hover:underline"
        >
          {vps.name}
        </Link>
      </TableCell>
      <TableCell>
        <StateBadge state={vps.lastKnownState} task={vps.task} />
      </TableCell>
      <TableCell>{vps.engine ?? "—"}</TableCell>
      <TableCell>
        {/* Internal/admin-only - never show this once a customer-facing view exists */}
        <Badge variant="secondary">{vps.sourcePlatform}</Badge>
      </TableCell>
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

export function VpsList({ sourceId, title = "VPS Instances" }: { sourceId?: number; title?: string }) {
  const { logout } = useAuth();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["vps", sourceId ?? "all"],
    queryFn: () => api.vpsList(sourceId != null ? { sourceId } : undefined),
    refetchInterval: 10_000, // matches the poller's own tick, see hst2171-architecture
    retry: (failureCount, err) => !(err instanceof UnauthorizedError) && failureCount < 3,
  });

  useEffect(() => {
    if (error instanceof UnauthorizedError) logout();
  }, [error, logout]);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
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
                <TableHead>Platform</TableHead>
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
