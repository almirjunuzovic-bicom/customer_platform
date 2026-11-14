const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:3001";

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

async function request<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.message ?? `Request to ${path} failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  clusters: () => request<Cluster[]>("/clusters"),
  partitions: () => request<Partition[]>("/partitions"),
  vpsList: () => request<VpsInventory[]>("/vps"),
  vpsHistory: (id: number) => request<VpsMetricPoint[]>(`/vps/${id}/history`),
};
