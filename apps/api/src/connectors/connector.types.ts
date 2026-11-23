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
  /** Allocated disk capacity in GB (unlike memLimit, which is MB) - total across every attached disk. */
  diskLimit: number | null;
  cpuUsage: number | null;
  memUsage: number | null;
  diskUsage: number | null;
  ccCount: number | null;
  pbxwareVersion: string | null;
  collectMetrics: boolean;
  ipAddresses: string[];
  uptimeSeconds: number;
  /**
   * Customer/billing annotations - `undefined` (the field simply absent)
   * means "this connector doesn't manage these, leave whatever's already in
   * vps_inventory alone" (SERVERware's mapVps never sets them - manual-only
   * for now, see schema.ts vpsInventory). A connector that DOES back these
   * with its own storage (AWS: Lightsail tags, see aws.types.ts) sets all
   * four explicitly on every sync - its own storage is the source of truth,
   * so this overwrites any local edit with the current tag value; `null`
   * means "connector manages this, but no value is currently set there"
   * (clears a previously-synced value, e.g. the tag was removed).
   */
  customerId?: string | null;
  customerName?: string | null;
  hostingPackage?: string | null;
  notificationEmails?: string[] | null;
}

/** Shape PATCH /vps/:id/customer edits - see SourceConnector.pushCustomerInfo. */
export interface CustomerInfoFields {
  customerId: string | null;
  customerName: string | null;
  hostingPackage: string | null;
  notificationEmails: string[] | null;
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

/**
 * What a connector needs to act on a specific VPS. `sourceVpsId` is enough
 * for SERVERware (its own native numeric id), but AWS's real identity is
 * (region, instanceName) - a string - so it also gets `uuid`, which every
 * connector already produces per-VPS (see SourceVps.uuid), to reverse that
 * back out. A plain row from `vpsInventory` already satisfies this shape.
 */
export interface VpsIdentity {
  sourceVpsId: number;
  uuid: string;
}

export interface SourceConnector {
  readonly connectorType: ConnectorType;
  listHosts(source: ResolvedSource): Promise<SourceHost[]>;
  listVpses(source: ResolvedSource): Promise<SourceVps[]>;
  listPartitions(source: ResolvedSource): Promise<SourcePartition[]>;
  startVps(source: ResolvedSource, vps: VpsIdentity): Promise<void>;
  stopVps(source: ResolvedSource, vps: VpsIdentity): Promise<void>;
  restartVps(source: ResolvedSource, vps: VpsIdentity): Promise<void>;
  getCallStats(source: ResolvedSource): Promise<CallStats>;
  getOverview(source: ResolvedSource): Promise<SourceOverview>;
  /**
   * Optional: connectors that back customer/billing fields with their own
   * storage (AWS: Lightsail tags) implement this to push a local edit back
   * out, so the source's own console and this platform always converge.
   * Connectors without this (SERVERware, Proxmox) simply don't implement
   * it - those fields stay manual-only, untouched by sync either way. See
   * vps.controller.ts updateCustomer.
   */
  pushCustomerInfo?(
    source: ResolvedSource,
    vps: VpsIdentity,
    fields: CustomerInfoFields,
  ): Promise<void>;
}
