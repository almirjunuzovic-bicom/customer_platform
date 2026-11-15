import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { parseCustomerId } from "../common/customer-id";
import { DATABASE, type Database } from "../db/database.module";
import {
  clusters,
  hosts,
  partitions,
  vpsEvents,
  vpsInventory,
  vpsMetricsHistory,
} from "../db/schema";
import { ServerwareService } from "../serverware/serverware.service";
import { ServerwareUnavailableError } from "../serverware/serverware.errors";
import {
  type ServerwareHost,
  type ServerwarePartition,
  type ServerwareVps,
} from "../serverware/serverware.types";
import { loadClusterConfigs } from "../serverware/serverware-cluster.config";
import type { SyncResult, VpsEventType } from "./sync.types";

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ServerwareService) private readonly serverware: ServerwareService,
  ) {}

  async syncAllClusters(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const { key } of loadClusterConfigs()) {
      results.push(await this.syncCluster(key));
    }
    return results;
  }

  async syncCluster(clusterKey: string): Promise<SyncResult> {
    const now = new Date();
    try {
      const [swHosts, swVpses, swPartitions] = await Promise.all([
        this.serverware.listHosts(clusterKey),
        this.serverware.listVpses(clusterKey),
        this.serverware.listPartitions(clusterKey),
      ]);

      const clusterId = await this.upsertCluster(clusterKey, now);
      await this.syncHosts(clusterId, swHosts, now);
      await this.syncPartitions(clusterId, swPartitions, now);

      const hostIdByServerwareId = await this.idMapFor(hosts, clusterId);
      const partitionIdByServerwareId = await this.idMapFor(
        partitions,
        clusterId,
      );
      await this.syncVpses(
        clusterId,
        swVpses,
        hostIdByServerwareId,
        partitionIdByServerwareId,
        now,
      );

      await this.db
        .update(clusters)
        .set({ lastSyncAt: now, lastSyncOk: true, lastSyncError: null })
        .where(eq(clusters.id, clusterId));

      return {
        clusterKey,
        ok: true,
        hostsCount: swHosts.length,
        vpsesCount: swVpses.length,
        partitionsCount: swPartitions.length,
      };
    } catch (error) {
      if (error instanceof ServerwareUnavailableError) {
        this.logger.warn(`Sync failed for "${clusterKey}": ${error.message}`);
        await this.db
          .update(clusters)
          .set({ lastSyncAt: now, lastSyncOk: false, lastSyncError: error.message })
          .where(eq(clusters.key, clusterKey));
        return { clusterKey, ok: false, error: error.message };
      }
      // Not a ServerWare problem (e.g. a DB error) - a real bug, don't hide it.
      throw error;
    }
  }

  private async upsertCluster(clusterKey: string, now: Date): Promise<number> {
    const config = loadClusterConfigs().find((c) => c.key === clusterKey);
    if (!config) throw new Error(`No config for cluster "${clusterKey}"`);

    await this.db
      .insert(clusters)
      .values({
        key: config.key,
        name: config.key,
        baseUrl: config.baseUrl,
        serverwareNetId: config.netId,
      })
      .onDuplicateKeyUpdate({
        set: { baseUrl: config.baseUrl, serverwareNetId: config.netId },
      });

    const [row] = await this.db
      .select({ id: clusters.id })
      .from(clusters)
      .where(eq(clusters.key, clusterKey))
      .limit(1);
    return row.id;
  }

  private async syncHosts(
    clusterId: number,
    swHosts: ServerwareHost[],
    now: Date,
  ): Promise<void> {
    for (const h of swHosts) {
      await this.db
        .insert(hosts)
        .values({
          clusterId,
          serverwareHostId: h.serverwareHostId,
          uuid: h.uuid,
          name: h.name,
          purpose: h.purpose,
          state: h.state,
          online: h.online,
          connected: h.connected,
          cpuUsage: h.cpuUsage,
          memUsage: h.memUsage,
          memTotal: h.memTotal,
          vpsCount: h.vpsCount,
          vpsRunning: h.vpsRunning,
          lastSyncedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            name: h.name,
            purpose: h.purpose,
            state: h.state,
            online: h.online,
            connected: h.connected,
            cpuUsage: h.cpuUsage,
            memUsage: h.memUsage,
            memTotal: h.memTotal,
            vpsCount: h.vpsCount,
            vpsRunning: h.vpsRunning,
            lastSyncedAt: now,
          },
        });
    }
  }

  private async syncPartitions(
    clusterId: number,
    swPartitions: ServerwarePartition[],
    now: Date,
  ): Promise<void> {
    for (const p of swPartitions) {
      const customerId = parseCustomerId(p.company);
      await this.db
        .insert(partitions)
        .values({
          clusterId,
          serverwarePartitionId: p.serverwarePartitionId,
          name: p.name,
          company: p.company,
          crmLink: p.crmLink,
          customerId,
          vpsQuota: p.vpsQuota,
          vpsUsage: p.vpsUsage,
          lastSyncedAt: now,
        })
        .onDuplicateKeyUpdate({
          set: {
            name: p.name,
            company: p.company,
            crmLink: p.crmLink,
            customerId,
            vpsQuota: p.vpsQuota,
            vpsUsage: p.vpsUsage,
            lastSyncedAt: now,
          },
        });
    }
  }

  /** Maps a ServerWare numeric id -> our own autoincrement id, for FK writes. */
  private async idMapFor(
    table: typeof hosts | typeof partitions,
    clusterId: number,
  ): Promise<Map<number, number>> {
    const idColumn =
      table === hosts ? hosts.serverwareHostId : partitions.serverwarePartitionId;
    const rows = await this.db
      .select({ id: table.id, serverwareId: idColumn })
      .from(table as any)
      .where(eq((table as any).clusterId, clusterId));
    return new Map(rows.map((r: any) => [r.serverwareId, r.id]));
  }

  private async syncVpses(
    clusterId: number,
    swVpses: ServerwareVps[],
    hostIdByServerwareId: Map<number, number>,
    partitionIdByServerwareId: Map<number, number>,
    now: Date,
  ): Promise<void> {
    const existingRows = await this.db
      .select()
      .from(vpsInventory)
      .where(eq(vpsInventory.clusterId, clusterId));
    const existingByServerwareId = new Map(
      existingRows.map((r) => [r.serverwareVpsId, r]),
    );
    const seenServerwareIds = new Set<number>();

    for (const vps of swVpses) {
      seenServerwareIds.add(vps.serverwareVpsId);
      const hostId = hostIdByServerwareId.get(vps.hostId) ?? null;
      const partitionId = partitionIdByServerwareId.get(vps.partitionId) ?? null;
      const prior = existingByServerwareId.get(vps.serverwareVpsId);

      let vpsInventoryId: number;

      if (!prior) {
        const [inserted] = await this.db.insert(vpsInventory).values({
          clusterId,
          serverwareVpsId: vps.serverwareVpsId,
          uuid: vps.uuid,
          hostId,
          partitionId,
          name: vps.name,
          engine: vps.engine,
          lastKnownState: vps.state,
          lastUptimeSeconds: vps.uptimeSeconds,
          task: vps.task || null,
          pbxwareVersion: vps.pbxwareVersion,
          memLimit: vps.memLimit,
          cpuLimit: vps.cpuLimit,
          cpuShare: vps.cpuShare,
          ioLimit: vps.ioLimit,
          diskState: vps.diskState,
          ipAddresses: vps.ipAddresses,
          collectMetrics: vps.collectMetrics,
          isRemoved: false,
          lastSyncedAt: now,
        });
        vpsInventoryId = inserted.insertId;
        await this.recordEvent(
          vpsInventoryId,
          "created",
          null,
          vps.name,
          now,
        );
      } else {
        vpsInventoryId = prior.id;

        if (prior.hostId !== hostId) {
          await this.recordEvent(
            vpsInventoryId,
            "host_changed",
            String(prior.hostId),
            String(hostId),
            now,
          );
        }
        if (prior.partitionId !== partitionId) {
          await this.recordEvent(
            vpsInventoryId,
            "partition_changed",
            String(prior.partitionId),
            String(partitionId),
            now,
          );
        }
        if (prior.memLimit !== vps.memLimit || prior.cpuLimit !== vps.cpuLimit) {
          await this.recordEvent(
            vpsInventoryId,
            "resource_changed",
            `mem=${prior.memLimit},cpu=${prior.cpuLimit}`,
            `mem=${vps.memLimit},cpu=${vps.cpuLimit}`,
            now,
          );
        }
        const stateChanged = prior.lastKnownState !== vps.state;
        if (stateChanged) {
          await this.recordEvent(
            vpsInventoryId,
            "state_changed",
            prior.lastKnownState,
            vps.state,
            now,
          );
        }
        // Restart goes RUNNING -> RUNNING with no visible state transition
        // (confirmed - see hst2171-serverware-api), so stateChanged alone
        // never catches it. A reboot resets uptime to ~0 though, and
        // uptime only ever climbs while actually running - a drop is a
        // reliable "it actually rebooted" signal on its own.
        const uptimeReset =
          prior.lastUptimeSeconds != null && vps.uptimeSeconds < prior.lastUptimeSeconds;

        await this.db
          .update(vpsInventory)
          .set({
            hostId,
            partitionId,
            name: vps.name,
            engine: vps.engine,
            lastKnownState: vps.state,
            lastUptimeSeconds: vps.uptimeSeconds,
            task: vps.task || null,
            // Confirmed state change OR a detected reboot = our own
            // start/stop/restart lock (if any) can be released early,
            // instead of waiting out its full staleness timeout (see
            // vps.controller.ts performAction).
            ...(stateChanged || uptimeReset
              ? { pendingAction: null, pendingActionAt: null }
              : {}),
            memLimit: vps.memLimit,
            cpuLimit: vps.cpuLimit,
            cpuShare: vps.cpuShare,
            ioLimit: vps.ioLimit,
            diskState: vps.diskState,
            ipAddresses: vps.ipAddresses,
            collectMetrics: vps.collectMetrics,
            isRemoved: false,
            lastSyncedAt: now,
          })
          .where(eq(vpsInventory.id, vpsInventoryId));
      }

      await this.db.insert(vpsMetricsHistory).values({
        vpsInventoryId,
        capturedAt: now,
        state: vps.state,
        cpuUsage: vps.cpuUsage,
        memUsage: vps.memUsage,
        diskUsage: vps.diskUsage,
        ccCount: vps.ccCount,
        uptimeSeconds: vps.uptimeSeconds,
      });
    }

    // Anything we had before but didn't see this tick has disappeared from
    // ServerWare's list - mark removed, don't delete (keep history/audit).
    for (const [serverwareId, row] of existingByServerwareId) {
      if (!seenServerwareIds.has(serverwareId) && !row.isRemoved) {
        await this.db
          .update(vpsInventory)
          .set({ isRemoved: true, lastSyncedAt: now })
          .where(eq(vpsInventory.id, row.id));
        await this.recordEvent(row.id, "removed", row.lastKnownState, null, now);
      }
    }
  }

  private async recordEvent(
    vpsInventoryId: number,
    eventType: VpsEventType,
    previousValue: string | null,
    newValue: string | null,
    detectedAt: Date,
  ): Promise<void> {
    await this.db.insert(vpsEvents).values({
      vpsInventoryId,
      eventType,
      previousValue,
      newValue,
      detectedAt,
      source: "poll_detected",
      actorUserId: null,
    });
  }
}
