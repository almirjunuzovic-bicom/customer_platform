import type { SourceHost, SourceVps } from "../connectors/connector.types";

/**
 * Wire shapes for Lightsail's JSON protocol (Lightsail_20161128), confirmed
 * against Bicom's internal AWS Monitor tool (daily2/aws_lightsail_client.php).
 */
export interface LightsailTagRaw {
  key?: string;
  value?: string;
}

export interface LightsailDiskRaw {
  sizeInGb?: number;
  isSystemDisk?: boolean;
}

export interface LightsailHardwareRaw {
  cpuCount?: number;
  ramSizeInGb?: number;
  disks?: LightsailDiskRaw[];
}

export interface LightsailStateRaw {
  code?: number;
  name: string; // pending | running | stopping | stopped | rebooting | shutting-down | terminated
}

export interface LightsailInstanceRaw {
  name: string;
  arn?: string;
  createdAt?: number;
  location?: { availabilityZone?: string; regionName?: string };
  bundleId?: string;
  publicIpAddress?: string;
  privateIpAddress?: string;
  ipv6Addresses?: string[];
  hardware?: LightsailHardwareRaw;
  state: LightsailStateRaw;
  tags?: LightsailTagRaw[];
}

export interface LightsailGetInstancesResponse {
  instances?: LightsailInstanceRaw[];
  nextPageToken?: string;
}

export interface LightsailGetInstanceResponse {
  instance?: LightsailInstanceRaw;
}

export interface LightsailMetricDatapointRaw {
  average?: number;
  maximum?: number;
  minimum?: number;
  sampleCount?: number;
  sum?: number;
  timestamp: number;
  unit?: string;
}

export interface LightsailGetInstanceMetricDataResponse {
  metricData?: LightsailMetricDatapointRaw[];
  metricName?: string;
}

/**
 * Deterministic, non-negative 31-bit hash (FNV-1a) - used as the stand-in
 * for sourceHostId/sourceVpsId, which are `int` columns in our schema
 * (shared with SERVERware, which does have real numeric native ids).
 * Lightsail's own identity is (region, instanceName) - a string - so this
 * hash is only ever used as an internal join key; the real identity is kept
 * in `uuid` ("region:instanceName" / plain region for the synthetic host)
 * and is what performAction reverses back out for Start/Stop/RebootInstance.
 * Collision risk is negligible at realistic fleet sizes but isn't zero -
 * flagged as a known tradeoff, not an oversight.
 */
export function hash32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash & 0x7fffffff;
}

/**
 * Tag keys this connector reads/writes on a Lightsail instance to back the
 * customer/billing fields (see connector.types.ts SourceVps) - confirmed
 * live against a real account that the user had already tagged this way by
 * hand in the Lightsail console (title-case, matching AWS's own console
 * tag-key convention). Deliberately never touches the "Description" tag -
 * that one's owned by Bicom's separate internal AWS Monitor tool as its own
 * free-text note field (see aws_lightsail_client.php reference), unrelated
 * to these.
 */
export const TAG_KEY_CUSTOMER_ID = "Customer ID";
export const TAG_KEY_CUSTOMER_NAME = "Customer Name";
export const TAG_KEY_HOSTING_PACKAGE = "Hosting Package";
export const TAG_KEY_NOTIFICATION_EMAILS = "Notification Emails";

function tagValue(raw: LightsailInstanceRaw, key: string): string | null {
  return raw.tags?.find((t) => t.key === key)?.value ?? null;
}

/**
 * Lightsail tag VALUES reject "," entirely (confirmed live - see
 * aws.service.ts pushCustomerInfo), so a written-back tag is always
 * space-separated, never comma-separated - split on either/both so a
 * stray comma (e.g. hand-typed directly in the Lightsail console) still
 * parses instead of silently merging emails together.
 */
function parseNotificationEmailsTag(value: string | null): string[] | null {
  if (!value) return null;
  const emails = value
    .split(/[\s,]+/)
    .map((e) => e.trim())
    .filter(Boolean);
  return emails.length > 0 ? emails : null;
}

function instanceIpAddresses(raw: LightsailInstanceRaw): string[] {
  return [raw.publicIpAddress, raw.privateIpAddress, ...(raw.ipv6Addresses ?? [])].filter(
    (ip): ip is string => !!ip,
  );
}

function isRunning(raw: LightsailInstanceRaw): boolean {
  return raw.state.name.toLowerCase() === "running";
}

/** Total capacity across every attached disk (system disk + any extra volumes), in GB. */
function totalDiskGb(raw: LightsailInstanceRaw): number | null {
  const disks = raw.hardware?.disks;
  if (!disks || disks.length === 0) return null;
  const total = disks.reduce((sum, d) => sum + (d.sizeInGb ?? 0), 0);
  return total > 0 ? total : null;
}

/**
 * Maps one Lightsail instance to our generic shape. Lightsail exposes
 * `state.name` with real transitional values (pending/stopping/rebooting),
 * unlike SERVERware where a restart leaves `state` unchanged - so there's
 * no need for the uptime-drop reboot-detection trick serverware.types.ts
 * relies on. No equivalent "uptime" field exists at all, so uptimeSeconds
 * is always 0 (harmless: SyncService's reboot-detection never fires since
 * prior.lastUptimeSeconds is always 0 too).
 */
export function toSourceVps(raw: LightsailInstanceRaw, region: string, cpuUsage: number | null): SourceVps {
  const uuid = `${region}:${raw.name}`;
  const ramMb = raw.hardware?.ramSizeInGb != null ? Math.round(raw.hardware.ramSizeInGb * 1024) : null;
  return {
    sourceVpsId: hash32(uuid),
    uuid,
    hostId: hash32(region),
    partitionId: null, // Lightsail has no tenant/partition concept
    name: raw.name,
    engine: null,
    state: raw.state.name.toUpperCase(),
    task: "", // no separate "operation in progress" marker - state.name covers it
    memLimit: ramMb,
    cpuLimit: raw.hardware?.cpuCount ?? null,
    cpuShare: null,
    ioLimit: null,
    diskState: null,
    diskLimit: totalDiskGb(raw),
    cpuUsage,
    memUsage: null, // Lightsail exposes no memory-utilization metric at all
    diskUsage: null, // nor disk usage
    ccCount: null, // not a PBXware concept
    pbxwareVersion: null,
    collectMetrics: true,
    ipAddresses: instanceIpAddresses(raw),
    uptimeSeconds: 0,
    // Lightsail tags are the source of truth for these - set on every sync
    // (even to null, when the tag is absent/removed), see SourceVps doc and
    // AwsLightsailService.pushCustomerInfo for the write-back direction.
    customerId: tagValue(raw, TAG_KEY_CUSTOMER_ID),
    customerName: tagValue(raw, TAG_KEY_CUSTOMER_NAME),
    hostingPackage: tagValue(raw, TAG_KEY_HOSTING_PACKAGE),
    notificationEmails: parseNotificationEmailsTag(tagValue(raw, TAG_KEY_NOTIFICATION_EMAILS)),
  };
}

/**
 * Synthetic "host" = one per configured region, since Lightsail has no
 * hypervisor-host entity of its own. Lets the existing host sync/mapping
 * plumbing (and the UI's Host column) work unmodified - region is the
 * closest AWS equivalent of "where this VPS physically lives".
 */
export function toSourceHost(region: string, instances: LightsailInstanceRaw[]): SourceHost {
  const memTotalKb = instances.reduce(
    (sum, inst) => sum + (inst.hardware?.ramSizeInGb ?? 0) * 1024 * 1024,
    0,
  );
  return {
    sourceHostId: hash32(region),
    uuid: region,
    name: region,
    purpose: null,
    state: null,
    online: true,
    connected: true,
    cpuUsage: null,
    memUsage: null,
    memTotal: instances.length > 0 ? memTotalKb : null,
    vpsCount: instances.length,
    vpsRunning: instances.filter(isRunning).length,
  };
}
