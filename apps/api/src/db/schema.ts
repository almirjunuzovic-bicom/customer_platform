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
 * Internal Bicom staff only (Hosting Team) - NOT partner/customer users,
 * that's a separate, deferred concern (see hst2171-architecture open
 * question #1). Simple email+password for now, explicitly temporary: will
 * be swapped for Google Workspace SSO later. Keyed on email on purpose -
 * SSO would key off email too, so this stays a clean swap: the rest of the
 * app only ever deals with a resolved `userId`, never with how login
 * happened.
 */
export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  email: varchar("email", { length: 256 }).notNull().unique(),
  name: varchar("name", { length: 128 }).notNull(),
  passwordHash: varchar("password_hash", { length: 256 }).notNull(),
  // Embedded in every issued JWT. Bumping this invalidates every outstanding
  // token for this user at once - the only revocation mechanism we have
  // (JWTs are otherwise stateless/unrevokable before they expire). See
  // revoke-user.manual.ts.
  tokenVersion: int("token_version").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
});

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
    // Which underlying infra provider this VPS actually lives on - plain
    // varchar (not an enum) since the known set will grow ("serverware" for
    // everything today, "aws"/"proxmox" planned later) and each needs its
    // own sync adapter, not a schema migration to add a value. Internal/
    // admin-only - customers should never see or care which platform
    // backs their VPS. Set once at insert, never changes on update: a VPS
    // moving providers is a new row via a different adapter, not an
    // in-place update of this one.
    sourcePlatform: varchar("source_platform", { length: 32 }).notNull().default("serverware"),
    // Cache of the most recent state seen, kept in lockstep with every poll.
    // Lets the dashboard read current status without touching the (much
    // bigger) history table, and lets the poller detect transitions without
    // an extra query. Source of truth for history remains vps_metrics_history.
    lastKnownState: varchar("last_known_state", { length: 32 }),
    // Cache of the last-seen uptime, purely to detect a reboot: restart
    // goes RUNNING -> RUNNING (no visible state transition per
    // hst2171-serverware-api), but SERVERware resets uptime to ~0 on
    // actual reboot. A drop in this value is what clears a "restart"
    // pendingAction early instead of sitting out the full timeout.
    lastUptimeSeconds: bigint("last_uptime_seconds", { mode: "number" }),
    // SERVERware's own "an operation is already in progress on this VPS"
    // marker (CREATING/MODIFYING/RESIZING/etc, "" when idle) - confirmed
    // live that start/stop/restart never SET this themselves, but the
    // server still 400s a start/stop/restart while some OTHER task is
    // non-empty, so we mirror that same guard client-side (see
    // hst2171-serverware-api).
    task: varchar("task", { length: 32 }),
    // Our OWN lock for start/stop/restart specifically (SERVERware's `task`
    // doesn't cover these - see above). Set atomically when an action is
    // accepted, cleared when the poller confirms the resulting state
    // change, and treated as stale/expired after PENDING_ACTION_TIMEOUT_MS
    // regardless (self-healing if a restart never shows a visible
    // transition, or the app crashes mid-action). Lives in the DB, not
    // browser state, so it's the same for every user's browser.
    pendingAction: varchar("pending_action", { length: 16 }),
    pendingActionAt: timestamp("pending_action_at"),
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
    // NULL for poll_detected events (nobody to attribute); set for
    // platform_action events once the actor is a real logged-in user.
    actorUserId: int("actor_user_id").references(() => users.id),
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
