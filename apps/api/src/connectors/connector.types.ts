/**
 * Generic, connector-agnostic shapes. SyncService and the schema only ever
 * deal with these - never with ServerWare's (or, later, AWS's/Proxmox's) own
 * wire format directly. Each connector maps its own raw API response into
 * these at the boundary (see serverware/serverware.service.ts's
 * toSourceHost/toSourceVps/toSourcePartition).
 */

export const CONNECTOR_TYPES = ["serverware", "aws", "proxmox"] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

export interface SourceHost {
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

export interface SourceVps {
  sourceVpsId: number;
  uuid: string;
  hostId: number | null;
  partitionId: number | null;
  name: string;
  engine: string | null;
  state: string;
  task: string;
  memLimit: number | null;
  cpuLimit: number | null;
  cpuShare: number | null;
  ioLimit: number | null;
  diskState: string | null;
  cpuUsage: number | null;
  memUsage: number | null;
  diskUsage: number | null;
  ccCount: number | null;
  pbxwareVersion: string | null;
  collectMetrics: boolean;
  ipAddresses: string[];
  uptimeSeconds: number;
}

/** Network/cluster-wide call volume - not per-VPS (confirmed live: SERVERware's
 * own dashboard endpoint only exposes a network-wide sum, see
 * hst2171-serverware-api). ServerWare/PBXware-specific concept - a
 * connector that doesn't have one throws via SourceUnavailableError same as
 * any other unsupported call. */
export interface CallStats {
  currentHour: number;
  today: number;
  yesterday: number;
  currentWeek: number;
  currentMonth: number;
}

/**
 * Network/cluster-wide "how's it doing" summary - confirmed live against
 * lon1 (see hst2171-serverware-api): matches our own SUM(hosts.mem_total)/
 * SUM(vps_inventory.mem_limit) exactly, so these ARE genuine aggregates,
 * not one host's own numbers (unlike the dashboard payload's nested `rtm`
 * sub-object, which turned out to just mirror the controller host's own
 * live stats - deliberately NOT exposed here for that reason). Units
 * normalized to GB here - SERVERware's own raw payload mixes KB (host
 * totals) and MB (VPS commitments), confirmed by cross-checking against
 * our own already-synced data, not assumed. Also deliberately excludes the
 * raw dashboard payload's `active_users` - confirmed via source read to be
 * a SERVERware-internal sw-auth session count (one per API token in active
 * use), not a partition/domain/tenant metric - not useful here at all, per
 * the user, so it's dropped entirely rather than kept-but-hidden.
 */
export interface SourceOverview {
  domainCount: number;
  hostCount: number;
  vpsCount: number;
  vpsRunning: number;
  concurrentCalls: number;
  callsThisHour: number;
  memTotalGb: number;
  memCommittedGb: number;
  storageTotalGb: number;
  storageCommittedGb: number;
}

export interface SourcePartition {
  sourcePartitionId: number;
  uuid: string;
  name: string;
  company: string | null;
  crmLink?: string;
  vpsQuota: number | null;
  vpsUsage: number | null;
}

/** A `sources` row with credentials decrypted - never persisted or logged in this shape. */
export interface ResolvedSource {
  id: number;
  key: string;
  connectorType: ConnectorType;
  config: Record<string, unknown>;
  credentials: Record<string, unknown>;
}

/**
 * The ONE error type a connector (or source resolution) should throw for
 * "this source can't be synced/acted on right now" - misconfiguration,
 * network failure, auth failure, not-implemented-yet. SyncService catches
 * exactly this type and records it as a sync failure; anything else (a DB
 * error, a programming bug) is a real bug and must keep propagating - see
 * hst2171-serverware-api: "Failed API call -> Unknown/stale, never silently
 * Stopped" and don't hide actual bugs behind that same path.
 */
export class SourceUnavailableError extends Error {
  constructor(
    public readonly sourceKey: string,
    public readonly cause: unknown,
  ) {
    super(`Source "${sourceKey}" unavailable: ${String(cause)}`);
    this.name = "SourceUnavailableError";
  }
}

export interface SourceConnector {
  readonly connectorType: ConnectorType;
  listHosts(source: ResolvedSource): Promise<SourceHost[]>;
  listVpses(source: ResolvedSource): Promise<SourceVps[]>;
  listPartitions(source: ResolvedSource): Promise<SourcePartition[]>;
  startVps(source: ResolvedSource, sourceVpsId: number): Promise<void>;
  stopVps(source: ResolvedSource, sourceVpsId: number): Promise<void>;
  restartVps(source: ResolvedSource, sourceVpsId: number): Promise<void>;
  getCallStats(source: ResolvedSource): Promise<CallStats>;
  getOverview(source: ResolvedSource): Promise<SourceOverview>;
}
