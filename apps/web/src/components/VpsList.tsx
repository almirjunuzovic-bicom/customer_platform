import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { api, UnauthorizedError, type Source, type VpsInventory } from "@/lib/api";
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

function VpsRow({
  vps,
  source,
  showSource,
}: {
  vps: VpsInventory;
  source: Source | undefined;
  showSource: boolean;
}) {
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
      {showSource && (
        <TableCell>
          <Link
            to="/sources/$sourceId"
            params={{ sourceId: String(vps.sourceId) }}
            className="hover:underline"
          >
            {source?.name ?? `#${vps.sourceId}`}
          </Link>
        </TableCell>
      )}
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

export function VpsList({ sourceId, title = "All VPSes" }: { sourceId?: number; title?: string }) {
  // Only fetched/shown when the list isn't already scoped to one source -
  // every row would repeat the same value otherwise.
  const showSource = sourceId == null;
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["vps", sourceId ?? "all"],
    queryFn: () => api.vpsList(sourceId != null ? { sourceId } : undefined),
    refetchInterval: 10_000, // matches the poller's own tick, see hst2171-architecture
    // Don't retry a 401 3 times before giving up - it's not transient, and
    // logout (see auth-context.tsx's onUnauthorized subscription) already
    // happens as soon as the first attempt reports it.
    retry: (failureCount, err) => !(err instanceof UnauthorizedError) && failureCount < 3,
  });
  const sourcesQuery = useQuery({
    queryKey: ["sources"],
    queryFn: api.sources,
    enabled: showSource,
  });
  const sourcesById = new Map((sourcesQuery.data ?? []).map((s) => [s.id, s]));

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
        {data && data.length === 0 && (
          <p className="text-sm text-muted-foreground">No VPSes found.</p>
        )}
        {data && data.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                {showSource && <TableHead>Source</TableHead>}
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
                <VpsRow
                  key={vps.id}
                  vps={vps}
                  source={sourcesById.get(vps.sourceId)}
                  showSource={showSource}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}
