import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "@tanstack/react-router";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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
import { StateBadge } from "@/components/StateBadge";
import { VpsActions } from "@/components/VpsActions";

function formatUptime(seconds: number | null): string {
  if (seconds == null) return "—";
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

function MetricChart({
  title,
  dataKey,
  color,
  data,
}: {
  title: string;
  dataKey: string;
  color: string;
  data: Array<Record<string, string | number | null>>;
}) {
  return (
    <div>
      {/* Single series - no legend box needed, the title already names it. */}
      <p className="mb-2 text-sm font-medium">{title}</p>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={data} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="time"
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            minTickGap={24}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={{ stroke: "var(--border)" }}
            width={32}
            domain={[0, 100]}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "var(--popover)",
              borderColor: "var(--border)",
              borderRadius: "var(--radius-md)",
              fontSize: 12,
            }}
            formatter={(value) => [`${value}%`, title]}
          />
          <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  state_changed: "State changed",
  host_changed: "Host changed",
  partition_changed: "Partition changed",
  resource_changed: "Resources changed",
  created: "Created",
  removed: "Removed",
  action_requested: "Action requested",
};

export function VpsDetail() {
  const { vpsId } = useParams({ from: "/vps/$vpsId" });
  const id = Number(vpsId);

  const vpsQuery = useQuery({
    queryKey: ["vps", id],
    queryFn: () => api.vpsGet(id),
    refetchInterval: 10_000,
  });
  const historyQuery = useQuery({
    queryKey: ["vps", id, "history"],
    queryFn: () => api.vpsHistory(id),
    refetchInterval: 10_000,
  });
  const eventsQuery = useQuery({
    queryKey: ["vps", id, "events"],
    queryFn: () => api.vpsEvents(id),
    refetchInterval: 10_000,
  });
  const hostsQuery = useQuery({ queryKey: ["hosts"], queryFn: api.hosts });
  const partitionsQuery = useQuery({ queryKey: ["partitions"], queryFn: api.partitions });
  const sourcesQuery = useQuery({ queryKey: ["sources"], queryFn: api.sources });

  if (vpsQuery.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (vpsQuery.isError || !vpsQuery.data) {
    return (
      <p className="text-destructive">
        Failed to load VPS: {(vpsQuery.error as Error)?.message ?? "not found"}
      </p>
    );
  }

  const vps = vpsQuery.data;
  const host = hostsQuery.data?.find((h) => h.id === vps.hostId);
  const partition = partitionsQuery.data?.find((p) => p.id === vps.partitionId);
  const source = sourcesQuery.data?.find((s) => s.id === vps.sourceId);
  const history = historyQuery.data ?? [];
  const chartData = history.map((point) => ({
    time: new Date(point.capturedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
    "CPU %": point.cpuUsage,
    "Memory %": point.memUsage,
    "Disk %": point.diskUsage,
  }));

  return (
    <div className="space-y-6">
      <div>
        <Link to="/" className="text-sm text-muted-foreground hover:underline">
          ← Back to VPS list
        </Link>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h2 className="text-xl font-semibold">{vps.name}</h2>
          <StateBadge state={vps.lastKnownState} task={vps.task} />
          {/* Internal/admin-only - never show this once a customer-facing view exists */}
          <Badge variant="secondary">{vps.sourcePlatform}</Badge>
        </div>
        <VpsActions
          vpsId={vps.id}
          vpsName={vps.name}
          state={vps.lastKnownState}
          task={vps.task}
          pendingAction={vps.pendingAction}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow label="Source" value={source ? `${source.name} (${source.key})` : vps.sourceId} />
            <InfoRow label="Host" value={host?.name ?? vps.hostId ?? "—"} />
            <InfoRow
              label="Partition"
              value={partition ? `${partition.name}${partition.company ? ` · ${partition.company}` : ""}` : "—"}
            />
            <InfoRow label="Engine" value={vps.engine ?? "—"} />
            <InfoRow label="PBXware version" value={vps.pbxwareVersion ?? "—"} />
            <InfoRow label="Uptime" value={formatUptime(vps.lastUptimeSeconds)} />
            <InfoRow label="IP addresses" value={(vps.ipAddresses ?? []).join(", ") || "—"} />
            <InfoRow label="UUID" value={<span className="font-mono text-xs">{vps.uuid}</span>} />
            <InfoRow label="Last synced" value={new Date(vps.lastSyncedAt).toLocaleString()} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resources</CardTitle>
          </CardHeader>
          <CardContent>
            <InfoRow label="Memory limit" value={vps.memLimit ? `${vps.memLimit} MB` : "—"} />
            <InfoRow label="CPU limit" value={vps.cpuLimit ?? "—"} />
            <InfoRow label="CPU share" value={vps.cpuShare ?? "—"} />
            <InfoRow label="IO limit" value={vps.ioLimit ?? "—"} />
            <InfoRow label="Disk state" value={vps.diskState ?? "—"} />
            <InfoRow label="Metrics collection" value={vps.collectMetrics ? "enabled" : "disabled"} />
            <InfoRow
              label="Pending action"
              value={vps.pendingAction ? `${vps.pendingAction} (since ${new Date(vps.pendingActionAt!).toLocaleTimeString()})` : "—"}
            />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>History</CardTitle>
        </CardHeader>
        <CardContent>
          {historyQuery.isLoading && <Skeleton className="h-64 w-full" />}
          {!historyQuery.isLoading && chartData.length === 0 && (
            <p className="text-sm text-muted-foreground">No history yet.</p>
          )}
          {chartData.length > 0 && (
            <div className="space-y-6">
              <MetricChart title="CPU" dataKey="CPU %" color="var(--chart-1)" data={chartData} />
              <MetricChart
                title="Memory"
                dataKey="Memory %"
                color="var(--chart-2)"
                data={chartData}
              />
              <MetricChart
                title="Storage"
                dataKey="Disk %"
                color="var(--chart-3)"
                data={chartData}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Events</CardTitle>
        </CardHeader>
        <CardContent>
          {eventsQuery.isLoading && <Skeleton className="h-32 w-full" />}
          {eventsQuery.data && eventsQuery.data.length === 0 && (
            <p className="text-sm text-muted-foreground">No events yet.</p>
          )}
          {eventsQuery.data && eventsQuery.data.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Event</TableHead>
                  <TableHead>Change</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Detected</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...eventsQuery.data]
                  .sort((a, b) => b.detectedAt.localeCompare(a.detectedAt))
                  .map((event) => (
                    <TableRow key={event.id}>
                      <TableCell>{EVENT_LABELS[event.eventType] ?? event.eventType}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {event.previousValue ?? "—"} → {event.newValue ?? "—"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={event.source === "platform_action" ? "default" : "secondary"}>
                          {event.source === "platform_action" ? "user action" : "poller"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(event.detectedAt).toLocaleString()}
                      </TableCell>
                    </TableRow>
                  ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
