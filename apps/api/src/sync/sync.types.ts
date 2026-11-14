export interface SyncResult {
  clusterKey: string;
  ok: boolean;
  hostsCount?: number;
  vpsesCount?: number;
  partitionsCount?: number;
  error?: string;
}

export type VpsEventType =
  | "state_changed"
  | "host_changed"
  | "partition_changed"
  | "resource_changed"
  | "created"
  | "removed";
