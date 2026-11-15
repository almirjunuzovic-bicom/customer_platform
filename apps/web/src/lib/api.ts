import { getToken } from "./token";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export class UnauthorizedError extends Error {}

export interface Source {
  id: number;
  key: string;
  name: string;
  connectorType: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
}

export interface Partition {
  id: number;
  sourceId: number;
  name: string;
  company: string | null;
  customerId: string | null;
  vpsQuota: number | null;
  vpsUsage: number | null;
}

export interface VpsInventory {
  id: number;
  sourceId: number;
  sourceVpsId: number;
  uuid: string;
  hostId: number | null;
  partitionId: number | null;
  name: string;
  engine: string | null;
  sourcePlatform: string;
  lastKnownState: string | null;
  lastUptimeSeconds: number | null;
  task: string | null; // SERVERware's own "other operation in progress" marker
  pendingAction: string | null; // our own start/stop/restart lock
  pendingActionAt: string | null;
  pbxwareVersion: string | null;
  memLimit: number | null;
  cpuLimit: number | null;
  cpuShare: number | null;
  ioLimit: number | null;
  diskState: string | null;
  ipAddresses: string[] | null;
  collectMetrics: boolean;
  isRemoved: boolean;
  lastSyncedAt: string;
}

export interface Host {
  id: number;
  sourceId: number;
  sourceHostId: number;
  uuid: string;
  name: string;
  purpose: string | null;
  state: string | null;
  online: boolean | null;
  connected: boolean | null;
  cpuUsage: number | null;
  memUsage: number | null;
  memTotal: number | null;
  vpsCount: number | null;
  vpsRunning: number | null;
}

export type VpsEventType =
  | "state_changed"
  | "host_changed"
  | "partition_changed"
  | "resource_changed"
  | "created"
  | "removed"
  | "action_requested";

export interface VpsEvent {
  id: number;
  vpsInventoryId: number;
  eventType: VpsEventType;
  previousValue: string | null;
  newValue: string | null;
  detectedAt: string;
  source: "poll_detected" | "platform_action";
  actorUserId: number | null;
}

export interface MetricSummary {
  peak: number | null;
  avg: number | null;
  min: number | null;
  current: number | null;
}

export interface HistorySummary {
  cpuUsage: MetricSummary;
  memUsage: MetricSummary;
  diskUsage: MetricSummary;
}

export interface SourceOverview {
  domainCount: number;
  hostCount: number;
  vpsCount: number;
  vpsRunning: number;
  activeUsers: number;
  concurrentCalls: number;
  callsThisHour: number;
  memTotalGb: number;
  memCommittedGb: number;
  storageTotalGb: number;
  storageCommittedGb: number;
}

export interface CallStats {
  currentHour: number;
  today: number;
  yesterday: number;
  currentWeek: number;
  currentMonth: number;
}

export interface VpsMetricPoint {
  capturedAt: string;
  state: string;
  cpuUsage: number | null;
  memUsage: number | null;
  diskUsage: number | null;
  ccCount: number | null;
  uptimeSeconds: number | null;
}

async function request<T>(
  path: string,
  method: "GET" | "POST" | "PATCH" = "GET",
  body?: unknown,
): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const responseBody = await res.json().catch(() => ({}));
    const message = responseBody.message ?? `Request to ${path} failed (${res.status})`;
    if (res.status === 401) throw new UnauthorizedError(message);
    throw new Error(Array.isArray(message) ? message.join(", ") : message);
  }
  return res.json();
}

export type VpsAction = "start" | "stop" | "restart";

export const CONNECTOR_TYPES = ["serverware", "aws", "proxmox"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export interface CreateSourceInput {
  key: string;
  name: string;
  connectorType: ConnectorType;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

export interface LoginResponse {
  token: string;
  user: { id: number; email: string; name: string };
}

export const api = {
  login: async (email: string, password: string): Promise<LoginResponse> => {
    const res = await fetch(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new UnauthorizedError(body.message ?? "Login failed");
    return body;
  },
  sources: () => request<Source[]>("/sources"),
  createSource: (input: CreateSourceInput) => request<Source>("/sources", "POST", input),
  setSourceEnabled: (id: number, enabled: boolean) =>
    request<Source>(`/sources/${id}`, "PATCH", { enabled }),
  callStats: (sourceId: number) => request<CallStats>(`/sources/${sourceId}/call-stats`),
  sourceOverview: (sourceId: number) => request<SourceOverview>(`/sources/${sourceId}/overview`),
  workerStatus: () =>
    request<{ service: string; active: boolean; state?: string }>("/ops/worker-status"),
  restartWorker: () =>
    request<{ status: string; service: string }>("/ops/restart-worker", "POST"),
  partitions: () => request<Partition[]>("/partitions"),
  hosts: () => request<Host[]>("/hosts"),
  vpsList: (filters?: { sourceId?: number; partitionId?: number }) => {
    const query = new URLSearchParams();
    if (filters?.sourceId != null) query.set("sourceId", String(filters.sourceId));
    if (filters?.partitionId != null) query.set("partitionId", String(filters.partitionId));
    const qs = query.toString();
    return request<VpsInventory[]>(`/vps${qs ? `?${qs}` : ""}`);
  },
  vpsGet: (id: number) => request<VpsInventory>(`/vps/${id}`),
  vpsHistory: (
    id: number,
    range?: { from?: string; to?: string; bucketSeconds?: number },
  ) => {
    const query = new URLSearchParams();
    if (range?.from) query.set("from", range.from);
    if (range?.to) query.set("to", range.to);
    if (range?.bucketSeconds) query.set("bucketSeconds", String(range.bucketSeconds));
    const qs = query.toString();
    return request<VpsMetricPoint[]>(`/vps/${id}/history${qs ? `?${qs}` : ""}`);
  },
  vpsHistorySummary: (id: number, range?: { from?: string; to?: string }) => {
    const query = new URLSearchParams();
    if (range?.from) query.set("from", range.from);
    if (range?.to) query.set("to", range.to);
    const qs = query.toString();
    return request<HistorySummary>(`/vps/${id}/history/summary${qs ? `?${qs}` : ""}`);
  },
  vpsEvents: (id: number) => request<VpsEvent[]>(`/vps/${id}/events`),
  vpsAction: (id: number, action: VpsAction) =>
    request<{ status: string; action: string; vpsId: number }>(
      `/vps/${id}/actions/${action}`,
      "POST",
    ),
};
