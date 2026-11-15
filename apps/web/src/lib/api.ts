import { getToken } from "./token";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

export class UnauthorizedError extends Error {}

export interface Cluster {
  id: number;
  key: string;
  name: string;
  baseUrl: string;
  lastSyncAt: string | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
}

export interface Partition {
  id: number;
  clusterId: number;
  name: string;
  company: string | null;
  customerId: string | null;
  vpsQuota: number | null;
  vpsUsage: number | null;
}

export interface VpsInventory {
  id: number;
  clusterId: number;
  hostId: number | null;
  partitionId: number | null;
  name: string;
  engine: string | null;
  lastKnownState: string | null;
  task: string | null; // SERVERware's own "other operation in progress" marker
  pendingAction: string | null; // our own start/stop/restart lock
  pendingActionAt: string | null;
  pbxwareVersion: string | null;
  memLimit: number | null;
  cpuLimit: number | null;
  ipAddresses: string[] | null;
  isRemoved: boolean;
  lastSyncedAt: string;
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

async function request<T>(path: string, method: "GET" | "POST" = "GET"): Promise<T> {
  const token = getToken();
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body.message ?? `Request to ${path} failed (${res.status})`;
    if (res.status === 401) throw new UnauthorizedError(message);
    throw new Error(message);
  }
  return res.json();
}

export type VpsAction = "start" | "stop" | "restart";

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
  clusters: () => request<Cluster[]>("/clusters"),
  partitions: () => request<Partition[]>("/partitions"),
  vpsList: () => request<VpsInventory[]>("/vps"),
  vpsHistory: (id: number) => request<VpsMetricPoint[]>(`/vps/${id}/history`),
  vpsAction: (id: number, action: VpsAction) =>
    request<{ status: string; action: string; vpsId: number }>(
      `/vps/${id}/actions/${action}`,
      "POST",
    ),
};
