import {
  mysqlTable,
  int,
  bigint,
  varchar,
  float,
  boolean,
  timestamp,
  json,
  mysqlEnum,
  uniqueIndex,
  index,
  text,
} from "drizzle-orm/mysql-core";
import { relations } from "drizzle-orm";

/**
 * One row per SERVERware cluster (lon1, cork1, ...). Base URL + static
 * metadata only - the API token lives in env vars, never in this table.
 */
export const clusters = mysqlTable("clusters", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 32 }).notNull().unique(), // e.g. "lon1"
  name: varchar("name", { length: 128 }).notNull(),
  baseUrl: varchar("base_url", { length: 256 }).notNull(),
  serverwareNetId: int("serverware_net_id").notNull().default(1),
  lastSyncAt: timestamp("last_sync_at"),
  lastSyncOk: boolean("last_sync_ok"),
  lastSyncError: text("last_sync_error"),
});

/**
 * Host inventory - rarely changes, diff-updated by the poller (not
 * append-only). Dynamic fields hold the LAST KNOWN snapshot only; no
 * host-level history table yet (lower priority than VPS metrics).
 */
export const hosts = mysqlTable(
  "hosts",
  {
    id: int("id").autoincrement().primaryKey(),
    clusterId: int("cluster_id")
      .notNull()
      .references(() => clusters.id),
    serverwareHostId: int("serverware_host_id").notNull(),
    uuid: varchar("uuid", { length: 64 }).notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    purpose: varchar("purpose", { length: 32 }), // STORAGE | PROCESSING
    state: varchar("state", { length: 32 }),
    online: boolean("online"),
    connected: boolean("connected"),
    cpuUsage: float("cpu_usage"),
    memUsage: float("mem_usage"),
    memTotal: bigint("mem_total", { mode: "number" }),
    vpsCount: int("vps_count"),
    vpsRunning: int("vps_running"),
    lastSyncedAt: timestamp("last_synced_at").notNull(),
  },
  (t) => ({
    clusterHostUnique: uniqueIndex("hosts_cluster_serverware_id_uq").on(
      t.clusterId,
      t.serverwareHostId,
    ),
  }),
);

/**
 * Partition mirror - SERVERware's own tenant concept. This is a synced
 * REFERENCE table only. It is NOT the same thing as "our partner account" -
 * the explicit, reviewed partner<->partition mapping (with Pending Review
 * workflow) is a separate concern, deferred until auth/identity is decided
 * (see hst2171-architecture open question #1).
 */
export const partitions = mysqlTable(
  "partitions",
  {
    id: int("id").autoincrement().primaryKey(),
    clusterId: int("cluster_id")
      .notNull()
      .references(() => clusters.id),
    serverwarePartitionId: int("serverware_partition_id").notNull(),
    name: varchar("name", { length: 128 }).notNull(),
    company: varchar("company", { length: 256 }),
    // Not a real link in practice - seen as a genuine URL, a literal "url"
    // placeholder, or absent entirely (see hst2171-serverware-api). Stored
    // for reference only, never relied on as the sole source of customerId.
    crmLink: varchar("crm_link", { length: 512 }),
    // Parsed from the numeric suffix on `company` (Bicom-internal customer
    // ID convention, not a SERVERware field - e.g. "Delta365 Ltd-99999" ->
    // 99999). NULL when no suffix is present (e.g. pure test partitions).
    // Suggested cross-cluster partner key, not an auto-trusted one - see
    // hst2171-architecture open question #1 (Pending Review principle).
    customerId: varchar("customer_id", { length: 32 }),
    vpsQuota: int("vps_quota"),
    vpsUsage: int("vps_usage"),
    lastSyncedAt: timestamp("last_synced_at").notNull(),
  },
  (t) => ({
    clusterPartitionUnique: uniqueIndex(
      "partitions_cluster_serverware_id_uq",
    ).on(t.clusterId, t.serverwarePartitionId),
    customerIdIdx: index("partitions_customer_id_idx").on(t.customerId),
  }),
);

/**
 * VPS inventory - rarely-changing fields only, diff-updated by the poller.
 * `root_password` is deliberately NOT a column here: never persist it, even
 * though the ServerWare schema allows it to exist (see hst2171-serverware-api).
 */
export const vpsInventory = mysqlTable(
  "vps_inventory",
  {
    id: int("id").autoincrement().primaryKey(),
    clusterId: int("cluster_id")
      .notNull()
      .references(() => clusters.id),
    serverwareVpsId: int("serverware_vps_id").notNull(),
    uuid: varchar("uuid", { length: 64 }).notNull().unique(), // needed for *_stats routes
    hostId: int("host_id").references(() => hosts.id),
    partitionId: int("partition_id").references(() => partitions.id),
    name: varchar("name", { length: 128 }).notNull(),
    engine: varchar("engine", { length: 16 }), // kvm | lxc
    // Cache of the most recent state seen, kept in lockstep with every poll.
    // Lets the dashboard read current status without touching the (much
    // bigger) history table, and lets the poller detect transitions without
    // an extra query. Source of truth for history remains vps_metrics_history.
    lastKnownState: varchar("last_known_state", { length: 32 }),
    pbxwareVersion: varchar("pbxware_version", { length: 32 }),
    memLimit: int("mem_limit"),
    cpuLimit: int("cpu_limit"),
    cpuShare: int("cpu_share"),
    ioLimit: bigint("io_limit", { mode: "number" }),
    diskState: varchar("disk_state", { length: 16 }),
    ipAddresses: json("ip_addresses").$type<string[]>(),
    collectMetrics: boolean("collect_metrics").notNull().default(false),
    isRemoved: boolean("is_removed").notNull().default(false), // true once it stops appearing in the list
    lastSyncedAt: timestamp("last_synced_at").notNull(),
  },
  (t) => ({
    clusterVpsUnique: uniqueIndex("vps_inventory_cluster_serverware_id_uq").on(
      t.clusterId,
      t.serverwareVpsId,
    ),
    partitionIdx: index("vps_inventory_partition_idx").on(t.partitionId),
  }),
);

/**
 * Dense append-only time series - one row per VPS per poll tick. Narrow on
 * purpose (see hst2171-architecture: ~400 VPS x 10s tick ~= 3.46M rows/day).
 * Plan: raw kept ~30-90 days, rolled up + pruned beyond that (not yet
 * implemented - rollup job is a later task, RANGE partitioning by
 * capturedAt is the planned mechanism for cheap pruning).
 */
export const vpsMetricsHistory = mysqlTable(
  "vps_metrics_history",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    vpsInventoryId: int("vps_inventory_id")
      .notNull()
      .references(() => vpsInventory.id),
    capturedAt: timestamp("captured_at").notNull(),
    state: varchar("state", { length: 32 }).notNull(), // RUNNING | STOPPED | ...
    cpuUsage: float("cpu_usage"),
    memUsage: float("mem_usage"),
    diskUsage: float("disk_usage"),
    ccCount: int("cc_count"),
    uptimeSeconds: bigint("uptime_seconds", { mode: "number" }),
  },
  (t) => ({
    vpsCapturedIdx: index("vps_metrics_history_vps_captured_idx").on(
      t.vpsInventoryId,
      t.capturedAt,
    ),
  }),
);

/**
 * Sparse append-only audit trail - one row per MEANINGFUL change, not per
 * poll tick. host_changed / partition_changed are tenant-isolation-sensitive
 * and must never be silently applied (see hst2171-architecture).
 */
export const vpsEventTypeEnum = mysqlEnum("event_type", [
  "state_changed",
  "host_changed",
  "partition_changed",
  "resource_changed",
  "created",
  "removed",
  "action_requested",
]);

export const vpsEventSourceEnum = mysqlEnum("source", [
  "poll_detected",
  "platform_action",
]);

export const vpsEvents = mysqlTable(
  "vps_events",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    vpsInventoryId: int("vps_inventory_id")
      .notNull()
      .references(() => vpsInventory.id),
    eventType: vpsEventTypeEnum.notNull(),
    previousValue: varchar("previous_value", { length: 256 }),
    newValue: varchar("new_value", { length: 256 }),
    detectedAt: timestamp("detected_at").notNull(),
    source: vpsEventSourceEnum.notNull(),
    // Nullable, no FK yet - the users table doesn't exist until auth is
    // decided (hst2171-architecture open question #1). Add the FK
    // constraint in a later migration once it does.
    actorUserId: int("actor_user_id"),
    metadata: json("metadata"),
  },
  (t) => ({
    vpsDetectedIdx: index("vps_events_vps_detected_idx").on(
      t.vpsInventoryId,
      t.detectedAt,
    ),
  }),
);

export const hostsRelations = relations(hosts, ({ one, many }) => ({
  cluster: one(clusters, { fields: [hosts.clusterId], references: [clusters.id] }),
  vpsInstances: many(vpsInventory),
}));

export const partitionsRelations = relations(partitions, ({ one, many }) => ({
  cluster: one(clusters, {
    fields: [partitions.clusterId],
    references: [clusters.id],
  }),
  vpsInstances: many(vpsInventory),
}));

export const vpsInventoryRelations = relations(vpsInventory, ({ one, many }) => ({
  cluster: one(clusters, {
    fields: [vpsInventory.clusterId],
    references: [clusters.id],
  }),
  host: one(hosts, { fields: [vpsInventory.hostId], references: [hosts.id] }),
  partition: one(partitions, {
    fields: [vpsInventory.partitionId],
    references: [partitions.id],
  }),
  metrics: many(vpsMetricsHistory),
  events: many(vpsEvents),
}));
