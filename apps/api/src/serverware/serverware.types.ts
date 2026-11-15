/**
 * Wire shapes, as confirmed against the real sw-wcp API (see
 * hst2171-serverware-api memory / SERVERWARE_API.md). "Raw" types mirror
 * exactly what the API returns. Clean (non-Raw) types are what the rest of
 * the app sees - mapped explicitly below, never passed through directly, so
 * that e.g. `root_password` can never leak past this module by accident.
 */

export interface ServerwareEnvelope<T> {
  status: "success" | string;
  data: T;
}

export interface ServerwareHostRaw {
  id: number;
  uuid: string;
  name: string;
  purpose: string; // "STORAGE" | "PROCESSING"
  state: string;
  online: boolean;
  connected: boolean;
  cpu_usage: number;
  mem_usage: number;
  mem_total: number;
  vps_count: number;
  vps_running: number;
}

export interface ServerwareHost {
  serverwareHostId: number;
  uuid: string;
  name: string;
  purpose: string;
  state: string;
  online: boolean;
  connected: boolean;
  cpuUsage: number;
  memUsage: number;
  memTotal: number;
  vpsCount: number;
  vpsRunning: number;
}

export interface ServerwareVpsRaw {
  id: number;
  uuid: string;
  host_id: number;
  partition_id: number;
  name: string;
  engine: string; // "kvm" | "lxc"
  state: string; // ground truth - NOT curr_state, see hst2171-serverware-api
  curr_state: string;
  // "" when idle, else e.g. CREATING/MODIFYING/RESIZING... - start/stop/
  // restart never set this themselves, but SERVERware 400s those calls
  // while some OTHER task is non-empty (confirmed live, see
  // hst2171-serverware-api).
  task: string;
  mem_limit: number;
  cpu_limit: number;
  cpu_share: number;
  io_limit: number;
  disk_state: string;
  cpu_usage: number;
  mem_usage: number;
  disk_usage: number;
  cc_count: number;
  pbxware_version: string;
  collect_metrics: boolean;
  ip_addresses: string[];
  up_down_time: { uptime: number; down_timestamp: number };
  /** Always empty on every cluster/VPS tested so far - NEVER persist this. */
  root_password?: string;
}

export interface ServerwareVps {
  serverwareVpsId: number;
  uuid: string;
  hostId: number;
  partitionId: number;
  name: string;
  engine: string;
  state: string;
  task: string;
  memLimit: number;
  cpuLimit: number;
  cpuShare: number;
  ioLimit: number;
  diskState: string;
  cpuUsage: number;
  memUsage: number;
  diskUsage: number;
  ccCount: number;
  pbxwareVersion: string;
  collectMetrics: boolean;
  ipAddresses: string[];
  uptimeSeconds: number;
  // deliberately no root_password field - see ServerwareVpsRaw
}

export interface ServerwarePartitionRaw {
  id: number;
  uuid: string;
  name: string;
  company: string;
  // Seen as a genuine URL, a literal "url" placeholder, or absent entirely
  // on different partitions - not reliable, see hst2171-serverware-api.
  crm_link?: string;
  vps_quota: number;
  vps_usage: number;
}

export interface ServerwarePartition {
  serverwarePartitionId: number;
  uuid: string;
  name: string;
  company: string;
  crmLink?: string;
  vpsQuota: number;
  vpsUsage: number;
}

/**
 * Network/cluster-wide call volume - confirmed live against the lon1 test
 * cluster (see hst2171-serverware-api): GET /api/networks/:netid/dashboard/
 * vps-call-stats. No per-VPS breakdown exists in sw-wcp's own code
 * (SUM(num_of_calls) with no vps_id filter anywhere it's read).
 */
export interface ServerwareCallStatsRaw {
  current_hour: number;
  today: number;
  yesterday: number;
  current_week: number;
  current_month: number;
}

export interface ServerwareCallStats {
  currentHour: number;
  today: number;
  yesterday: number;
  currentWeek: number;
  currentMonth: number;
}

export function mapCallStats(raw: ServerwareCallStatsRaw): ServerwareCallStats {
  return {
    currentHour: raw.current_hour,
    today: raw.today,
    yesterday: raw.yesterday,
    currentWeek: raw.current_week,
    currentMonth: raw.current_month,
  };
}

/**
 * GET /api/networks/:netid/dashboard - confirmed live against lon1:
 * mem_hosts_total (KB) === SUM(hosts.mem_total), mem_vpses_committed (MB,
 * a DIFFERENT unit) === SUM(vps_inventory.mem_limit) - cross-checked
 * against our own already-synced data, not assumed. `rtm` deliberately
 * excluded from the clean type - it mirrors the controller host's own
 * live stats specifically (its mem_total matched one specific host
 * exactly), not a network aggregate, so showing it as "the cluster's load"
 * would be wrong.
 */
export interface ServerwareDashboardRaw {
  domain_count: number;
  host_count: number;
  vps_count: number;
  vps_running: number;
  // Deliberately NOT mapped into ServerwareDashboard/SourceOverview - this
  // is sw-auth's own live session count (one per API token in active use),
  // not partitions/domains/tenants/real users despite the name, confirmed
  // via source read. Not useful to this app, per the user, so dropped here
  // rather than carried through unused.
  active_users: number;
  cc_count: number;
  call_stats_curr_hour: number;
  mem_hosts_total: number; // KB
  mem_vpses_committed: number; // MB (not KB - confirmed, see above)
  stor_hosts_total: number; // GB
  stor_vpses_committed: number; // GB
}

export interface ServerwareDashboard {
  domainCount: number;
  hostCount: number;
  vpsCount: number;
  vpsRunning: number;
  ccCount: number;
  callStatsCurrHour: number;
  memHostsTotalKb: number;
  memVpsesCommittedMb: number;
  storHostsTotalGb: number;
  storVpsesCommittedGb: number;
}

export function mapDashboard(raw: ServerwareDashboardRaw): ServerwareDashboard {
  return {
    domainCount: raw.domain_count,
    hostCount: raw.host_count,
    vpsCount: raw.vps_count,
    vpsRunning: raw.vps_running,
    ccCount: raw.cc_count,
    callStatsCurrHour: raw.call_stats_curr_hour,
    memHostsTotalKb: raw.mem_hosts_total,
    memVpsesCommittedMb: raw.mem_vpses_committed,
    storHostsTotalGb: raw.stor_hosts_total,
    storVpsesCommittedGb: raw.stor_vpses_committed,
  };
}

export function mapHost(raw: ServerwareHostRaw): ServerwareHost {
  return {
    serverwareHostId: raw.id,
    uuid: raw.uuid,
    name: raw.name,
    purpose: raw.purpose,
    state: raw.state,
    online: raw.online,
    connected: raw.connected,
    cpuUsage: raw.cpu_usage,
    memUsage: raw.mem_usage,
    memTotal: raw.mem_total,
    vpsCount: raw.vps_count,
    vpsRunning: raw.vps_running,
  };
}

export function mapVps(raw: ServerwareVpsRaw): ServerwareVps {
  return {
    serverwareVpsId: raw.id,
    uuid: raw.uuid,
    hostId: raw.host_id,
    partitionId: raw.partition_id,
    name: raw.name,
    engine: raw.engine,
    state: raw.state,
    task: raw.task,
    memLimit: raw.mem_limit,
    cpuLimit: raw.cpu_limit,
    cpuShare: raw.cpu_share,
    ioLimit: raw.io_limit,
    diskState: raw.disk_state,
    cpuUsage: raw.cpu_usage,
    memUsage: raw.mem_usage,
    diskUsage: raw.disk_usage,
    ccCount: raw.cc_count,
    pbxwareVersion: raw.pbxware_version,
    collectMetrics: raw.collect_metrics,
    ipAddresses: raw.ip_addresses ?? [],
    uptimeSeconds: raw.up_down_time?.uptime ?? 0,
  };
}

export function mapPartition(raw: ServerwarePartitionRaw): ServerwarePartition {
  return {
    serverwarePartitionId: raw.id,
    uuid: raw.uuid,
    name: raw.name,
    company: raw.company,
    crmLink: raw.crm_link,
    vpsQuota: raw.vps_quota,
    vpsUsage: raw.vps_usage,
  };
}
