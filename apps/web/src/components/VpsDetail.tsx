import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { toast } from "sonner";
import { api, type VpsInventory } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { IpAddressList } from "@/components/CopyableIp";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  onExpand,
}: {
  title: string;
  dataKey: string;
  color: string;
  data: Array<Record<string, string | number | null>>;
  onExpand: () => void;
}) {
  return (
    <div>
      {/* Single series - no legend box needed, the title already names it. */}
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium">{title}</p>
        <Button variant="outline" size="sm" onClick={onExpand}>
          Details
        </Button>
      </div>
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

type MetricKey = "cpu" | "mem" | "disk";

const METRIC_CONFIG: Record<
  MetricKey,
  { title: string; field: "cpuUsage" | "memUsage" | "diskUsage"; color: string }
> = {
  cpu: { title: "CPU", field: "cpuUsage", color: "var(--chart-1)" },
  mem: { title: "Memory", field: "memUsage", color: "var(--chart-2)" },
  disk: { title: "Storage", field: "diskUsage", color: "var(--chart-3)" },
};

type RangePreset = "1h" | "6h" | "24h" | "7d" | "all" | "custom";

const RANGE_PRESETS: { key: RangePreset; label: string }[] = [
  { key: "1h", label: "Last hour" },
  { key: "6h", label: "Last 6 hours" },
  { key: "24h", label: "Last 24 hours" },
  { key: "7d", label: "Last 7 days" },
  { key: "all", label: "All" },
  { key: "custom", label: "Custom" },
];

const PRESET_HOURS: Partial<Record<RangePreset, number>> = {
  "1h": 1,
  "6h": 6,
  "24h": 24,
  "7d": 24 * 7,
};

function presetToRange(
  preset: RangePreset,
  customFrom: string,
  customTo: string,
): { from?: string; to?: string } {
  if (preset === "all") return {};
  if (preset === "custom") {
    return {
      from: customFrom ? new Date(customFrom).toISOString() : undefined,
      to: customTo ? new Date(customTo).toISOString() : undefined,
    };
  }
  const hours = PRESET_HOURS[preset]!;
  return { from: new Date(Date.now() - hours * 3600_000).toISOString() };
}

const TARGET_CHART_POINTS = 300;

/**
 * How coarse a bucket the /history endpoint should average over, given the
 * actual span being viewed - sized so ~300 points come back regardless of
 * range, computed from the span we already know rather than guessing a
 * fixed interval per preset. Replaces client-side downsampling: that only
 * fixed Recharts' render cost, not the cost of fetching/parsing every raw
 * row over the network in the first place (confirmed live: "7 days"/"All"
 * was still hauling tens of thousands of rows just to throw most away).
 * "All" (no `from`) falls back to a safe coarse default since the true
 * span isn't known upfront without an extra query.
 */
function bucketSecondsForRange(from?: string, to?: string): number {
  if (!from) return 3600;
  const toMs = to ? new Date(to).getTime() : Date.now();
  const spanSeconds = (toMs - new Date(from).getTime()) / 1000;
  const raw = Math.ceil(spanSeconds / TARGET_CHART_POINTS);
  return Math.max(10, Math.ceil(raw / 10) * 10); // round up to a multiple of the 10s poller tick
}

function StatTile({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="rounded-lg border p-3 text-center">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-lg font-semibold tabular-nums">
        {value != null ? `${value.toFixed(1)}%` : "—"}
      </p>
    </div>
  );
}

function MetricDetailDialog({
  vpsId,
  metric,
  onClose,
}: {
  vpsId: number;
  metric: MetricKey | null;
  onClose: () => void;
}) {
  const [preset, setPreset] = useState<RangePreset>("24h");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const range = useMemo(
    () => presetToRange(preset, customFrom, customTo),
    [preset, customFrom, customTo],
  );
  const bucketSeconds = useMemo(
    () => bucketSecondsForRange(range.from, range.to),
    [range.from, range.to],
  );
  const config = metric ? METRIC_CONFIG[metric] : null;

  const query = useQuery({
    queryKey: ["vps", vpsId, "history", range.from ?? null, range.to ?? null, bucketSeconds],
    queryFn: () => api.vpsHistory(vpsId, { ...range, bucketSeconds }),
    enabled: metric !== null,
    refetchInterval: 10_000,
  });
  // Separate SQL-aggregate query, deliberately not derived from the
  // (possibly bucket-averaged) points above - an averaged bucket would
  // already have smoothed away the true peak/min.
  const summaryQuery = useQuery({
    queryKey: ["vps", vpsId, "history-summary", range.from ?? null, range.to ?? null],
    queryFn: () => api.vpsHistorySummary(vpsId, range),
    enabled: metric !== null,
    refetchInterval: 10_000,
  });

  const points = query.data ?? [];
  const stats = config ? summaryQuery.data?.[config.field] : undefined;
  const chartData = config
    ? points.map((p) => ({
        time: new Date(p.capturedAt).toLocaleString([], {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        }),
        value: p[config.field],
      }))
    : [];

  return (
    <Dialog open={metric !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>{config?.title} usage</DialogTitle>
        </DialogHeader>

        <div className="flex flex-wrap gap-2">
          {RANGE_PRESETS.map((opt) => (
            <Button
              key={opt.key}
              size="sm"
              variant={preset === opt.key ? "default" : "outline"}
              onClick={() => setPreset(opt.key)}
            >
              {opt.label}
            </Button>
          ))}
        </div>

        {preset === "custom" && (
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="range-from">From</Label>
              <Input
                id="range-from"
                type="datetime-local"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="range-to">To</Label>
              <Input
                id="range-to"
                type="datetime-local"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </div>
          </div>
        )}

        {stats && (
          <div className="grid grid-cols-4 gap-3">
            <StatTile label="Peak" value={stats.peak} />
            <StatTile label="Average" value={stats.avg} />
            <StatTile label="Min" value={stats.min} />
            <StatTile label="Current" value={stats.current} />
          </div>
        )}

        {query.isLoading && <Skeleton className="h-80 w-full" />}
        {!query.isLoading && chartData.length === 0 && (
          <p className="text-sm text-muted-foreground">No data in this range.</p>
        )}
        {chartData.length > 0 && config && (
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={chartData} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="time"
                stroke="var(--muted-foreground)"
                fontSize={11}
                tickLine={false}
                axisLine={{ stroke: "var(--border)" }}
                minTickGap={32}
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
                formatter={(value) => [`${value}%`, config.title]}
              />
              <Line type="monotone" dataKey="value" stroke={config.color} strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Manual customer/billing annotations - same on every connectorType.
 * Nothing pulls these automatically today (not even for SERVERware, though
 * its partitions.customerId could feed this later - deferred, not built
 * yet); for AWS there's no connector-side data to derive them from at all,
 * so manual entry is the only option. See db/schema.ts vpsInventory.
 */
function CustomerCard({ vps }: { vps: VpsInventory }) {
  const queryClient = useQueryClient();
  const [isEditing, setIsEditing] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [hostingPackage, setHostingPackage] = useState("");
  const [notificationEmails, setNotificationEmails] = useState("");

  const mutation = useMutation({
    mutationFn: () => {
      const emails = notificationEmails
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      return api.updateVpsCustomer(vps.id, {
        customerId: customerId.trim() || null,
        customerName: customerName.trim() || null,
        hostingPackage: hostingPackage.trim() || null,
        notificationEmails: emails.length > 0 ? emails : null,
      });
    },
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["vps", vps.id] });
      if (updated.pushWarning) {
        toast.warning("Saved locally, but failed to update it on the source", {
          description: updated.pushWarning,
        });
      } else {
        toast.success("Customer details saved");
      }
      setIsEditing(false);
    },
    onError: (error) => toast.error((error as Error).message),
  });

  function startEditing() {
    setCustomerId(vps.customerId ?? "");
    setCustomerName(vps.customerName ?? "");
    setHostingPackage(vps.hostingPackage ?? "");
    setNotificationEmails((vps.notificationEmails ?? []).join(", "));
    setIsEditing(true);
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Customer</CardTitle>
          {!isEditing && (
            <Button variant="outline" size="sm" onClick={startEditing}>
              Edit
            </Button>
          )}
        </div>
        {vps.sourcePlatform === "aws" && (
          <p className="text-xs text-muted-foreground">
            Synced with this instance's Lightsail tags - editing here also updates them there.
          </p>
        )}
      </CardHeader>
      <CardContent>
        {isEditing ? (
          <form
            className="space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="customer-id">Customer ID</Label>
                <Input
                  id="customer-id"
                  value={customerId}
                  onChange={(e) => setCustomerId(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="customer-name">Customer name</Label>
                <Input
                  id="customer-name"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="hosting-package">Hosting package</Label>
                <Input
                  id="hosting-package"
                  value={hostingPackage}
                  onChange={(e) => setHostingPackage(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="notification-emails">Notification emails</Label>
                <Input
                  id="notification-emails"
                  placeholder="e.g. ops@example.com, billing@example.com"
                  value={notificationEmails}
                  onChange={(e) => setNotificationEmails(e.target.value)}
                />
              </div>
            </div>
            {mutation.isError && (
              <p className="text-sm text-destructive">{(mutation.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving..." : "Save"}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={mutation.isPending}
                onClick={() => setIsEditing(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <>
            <InfoRow label="Customer ID" value={vps.customerId ?? "—"} />
            <InfoRow label="Customer name" value={vps.customerName ?? "—"} />
            <InfoRow label="Hosting package" value={vps.hostingPackage ?? "—"} />
            <InfoRow
              label="Notification emails"
              value={(vps.notificationEmails ?? []).join(", ") || "—"}
            />
          </>
        )}
      </CardContent>
    </Card>
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
  const [expandedMetric, setExpandedMetric] = useState<MetricKey | null>(null);

  const vpsQuery = useQuery({
    queryKey: ["vps", id],
    queryFn: () => api.vpsGet(id),
    refetchInterval: 10_000,
  });
  // Fixed at mount, not recomputed every render - a 24h-ago cutoff from
  // when the page was opened is fine, and a stable value keeps the query
  // key (and thus the cache) stable across re-renders.
  const overviewFrom = useMemo(() => new Date(Date.now() - 24 * 3600_000).toISOString(), []);
  const historyQuery = useQuery({
    queryKey: ["vps", id, "history", "24h"],
    // Unbounded, unbucketed history made this page visibly lag - at 10s
    // resolution it's 8640+ rows per day and growing, both over the wire
    // and for Recharts to render. Last 24h, averaged into ~300 buckets
    // server-side, is enough for a "how's it doing" glance; the per-metric
    // Details dialog is where a longer/exact-stats range belongs.
    queryFn: () => api.vpsHistory(id, { from: overviewFrom, bucketSeconds: 300 }),
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
          <Badge variant={vps.sourcePlatform === "aws" ? "warning" : "secondary"}>
            {vps.sourcePlatform}
          </Badge>
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
            <InfoRow label="IP addresses" value={<IpAddressList ips={vps.ipAddresses} />} />
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
            {/* No cpuLimit (0/null) means no CPU cap was set - "∞", not "—" (missing data). */}
            <InfoRow label="CPU limit" value={vps.cpuLimit || "∞"} />
            <InfoRow label="CPU share" value={vps.cpuShare ?? "—"} />
            <InfoRow label="IO limit" value={vps.ioLimit ?? "—"} />
            <InfoRow label="Disk state" value={vps.diskState ?? "—"} />
            <InfoRow label="Disk" value={vps.diskLimit ? `${vps.diskLimit} GB` : "—"} />
            <InfoRow label="Metrics collection" value={vps.collectMetrics ? "enabled" : "disabled"} />
            <InfoRow
              label="Pending action"
              value={vps.pendingAction ? `${vps.pendingAction} (since ${new Date(vps.pendingActionAt!).toLocaleTimeString()})` : "—"}
            />
          </CardContent>
        </Card>
      </div>

      <CustomerCard vps={vps} />

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
              <MetricChart
                title="CPU"
                dataKey="CPU %"
                color="var(--chart-1)"
                data={chartData}
                onExpand={() => setExpandedMetric("cpu")}
              />
              <MetricChart
                title="Memory"
                dataKey="Memory %"
                color="var(--chart-2)"
                data={chartData}
                onExpand={() => setExpandedMetric("mem")}
              />
              <MetricChart
                title="Storage"
                dataKey="Disk %"
                color="var(--chart-3)"
                data={chartData}
                onExpand={() => setExpandedMetric("disk")}
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

      <MetricDetailDialog
        vpsId={id}
        metric={expandedMetric}
        onClose={() => setExpandedMetric(null)}
      />
    </div>
  );
}
