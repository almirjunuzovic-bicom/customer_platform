import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { api, type DevStatus as DevStatusData, type HealthCheck, type Source } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAuth } from "@/lib/auth-context";

// A source stops looking "fresh" once it's been this long since its last
// sync - 3x the worker's 10s poll interval (see scheduling.constants.ts),
// so one or two missed ticks don't false-positive as stale.
const STALE_AFTER_MS = 30_000;

function HealthBadge({ label, check }: { label: string; check: HealthCheck }) {
  return (
    <Badge variant={check.ok ? "success" : "destructive"} title={check.error}>
      {check.ok ? <CheckCircle2 className="size-3" /> : <XCircle className="size-3" />}
      {label}
    </Badge>
  );
}

function WorkerControls({ worker }: { worker: DevStatusData["worker"] }) {
  const { isAdmin } = useAuth();
  const queryClient = useQueryClient();

  function afterChange() {
    // The new state takes a moment to settle (process spawn/kill, or a
    // systemd transition) - an immediate refetch would likely still show
    // the old status.
    setTimeout(() => queryClient.invalidateQueries({ queryKey: ["dev-status"] }), 2000);
  }

  const start = useMutation({
    mutationFn: api.startWorker,
    onSuccess: () => {
      toast.success("Worker started");
      afterChange();
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const stop = useMutation({
    mutationFn: api.stopWorker,
    onSuccess: () => {
      toast.success("Worker stopped");
      afterChange();
    },
    onError: (error) => toast.error((error as Error).message),
  });
  const restart = useMutation({
    mutationFn: api.restartWorker,
    onSuccess: () => {
      toast.success("Worker restarted");
      afterChange();
    },
    onError: (error) => toast.error((error as Error).message),
  });

  const pending = start.isPending || stop.isPending || restart.isPending;

  return (
    <div className="flex items-center gap-2">
      <Badge variant={worker.active ? "success" : "destructive"}>
        worker: {worker.active ? "running" : (worker.state ?? "stopped")}
      </Badge>
      <Badge variant="outline">{worker.managed === "systemd" ? "systemd (staging)" : "local process"}</Badge>
      {worker.pid != null && <span className="text-xs text-muted-foreground">pid {worker.pid}</span>}
      <div className="ml-auto flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!isAdmin || pending || worker.active}
          title={isAdmin ? undefined : "Admin only"}
          onClick={() => start.mutate()}
        >
          Start
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!isAdmin || pending || !worker.active}
          title={isAdmin ? undefined : "Admin only"}
          onClick={() => stop.mutate()}
        >
          Stop
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!isAdmin || pending}
          title={isAdmin ? undefined : "Admin only"}
          onClick={() => restart.mutate()}
        >
          Restart
        </Button>
      </div>
    </div>
  );
}

function SourceFreshnessRow({ source }: { source: Source }) {
  const ageMs = source.lastSyncAt ? Date.now() - new Date(source.lastSyncAt).getTime() : null;
  const isStale = source.enabled && (ageMs == null || ageMs > STALE_AFTER_MS);

  return (
    <TableRow>
      <TableCell className="font-medium">{source.key}</TableCell>
      <TableCell>{source.enabled ? "enabled" : "disabled"}</TableCell>
      <TableCell>
        {source.lastSyncAt ? new Date(source.lastSyncAt).toLocaleTimeString() : "never"}
      </TableCell>
      <TableCell>
        {!source.enabled ? (
          <Badge variant="outline">n/a</Badge>
        ) : isStale ? (
          <Badge variant="destructive" title="No sync in the last 30s - is the worker running?">
            stale
          </Badge>
        ) : (
          <Badge variant="success">fresh</Badge>
        )}
      </TableCell>
    </TableRow>
  );
}

export function DevStatus() {
  const status = useQuery({
    queryKey: ["dev-status"],
    queryFn: api.devStatus,
    refetchInterval: 10_000,
  });
  const sources = useQuery({
    queryKey: ["sources"],
    queryFn: api.sources,
    refetchInterval: 10_000,
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Dev status</CardTitle>
          <CardDescription>
            Internal tool for local development - shows whether the API/worker/DB/Redis
            processes are actually up, since a stopped worker otherwise fails silently
            (the UI just shows stale data). Temporary: remove once the team has a better
            ops story.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {status.isLoading && <Skeleton className="h-8 w-full" />}
          {status.isError && (
            <p className="text-destructive">
              Failed to load status: {(status.error as Error).message}
            </p>
          )}
          {status.data && (
            <>
              <WorkerControls worker={status.data.worker} />
              <div className="flex gap-2">
                <HealthBadge label="database" check={status.data.db} />
                <HealthBadge label="redis" check={status.data.redis} />
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Source sync freshness</CardTitle>
          <CardDescription>
            An enabled source that hasn't synced in the last 30s almost always means the
            worker isn't running, not a real sync failure (check lastSyncError on the
            Sources page for that).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sources.isLoading && <Skeleton className="h-8 w-full" />}
          {sources.isError && (
            <p className="text-destructive">
              Failed to load sources: {(sources.error as Error).message}
            </p>
          )}
          {sources.data && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Last sync</TableHead>
                  <TableHead>Freshness</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sources.data.map((source) => (
                  <SourceFreshnessRow key={source.id} source={source} />
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
