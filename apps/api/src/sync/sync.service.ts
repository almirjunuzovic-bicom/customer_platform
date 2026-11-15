import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { parseCustomerId } from "../common/customer-id";
import { ConnectorRegistryService } from "../connectors/connector-registry.service";
import {
  SourceUnavailableError,
  type ConnectorType,
  type SourceHost,
  type SourcePartition,
  type SourceVps,
} from "../connectors/connector.types";
import { SourcesService } from "../connectors/sources.service";
import { DATABASE, type Database } from "../db/database.module";
import {
  hosts,
  partitions,
  sources,
  vpsEvents,
  vpsInventory,
  vpsMetricsHistory,
} from "../db/schema";
import type { SyncResult, VpsEventType } from "./sync.types";

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ConnectorRegistryService) private readonly connectorRegistry: ConnectorRegistryService,
    @Inject(SourcesService) private readonly sourcesService: SourcesService,
  ) {}

  async syncAllSources(): Promise<SyncResult[]> {
    const enabledSources = await this.sourcesService.listEnabled();
    const results: SyncResult[] = [];
    for (const { id } of enabledSources) {
      results.push(await this.syncSource(id));
    }
    return results;
  }

  async syncSource(sourceId: number): Promise<SyncResult> {
    const now = new Date();
    const [sourceRow] = await this.db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
    if (!sourceRow) {
      // Not a connector problem (e.g. a stale scheduled job for a deleted
      // source) - a real bug/race, don't hide it as a sync failure.
      throw new Error(`No source with id ${sourceId}`);
    }

    try {
      const resolved = await this.sourcesService.resolve(sourceId);
      const connector = this.connectorRegistry.get(resolved.connectorType);

      const [srcHosts, srcVpses, srcPartitions] = await Promise.all([
        connector.listHosts(resolved),
        connector.listVpses(resolved),
        connector.listPartitions(resolved),
      ]);

      await this.syncHosts(sourceId, srcHosts, now);
      await this.syncPartitions(sourceId, srcPartitions, now);

      const hostIdBySourceHostId = await this.idMapFor(hosts, "sourceHostId", sourceId);
      const partitionIdBySourcePartitionId = await this.idMapFor(partitions, "sourcePartitionId", sourceId);
      await this.syncVpses(
        sourceId,
        srcVpses,
        hostIdBySourceHostId,
        partitionIdBySourcePartitionId,
        resolved.connectorType,
        now,
      );

      await this.db
        .update(sources)
        .set({ lastSyncAt: now, lastSyncOk: true, lastSyncError: null })
        .where(eq(sources.id, sourceId));

      return {
        sourceKey: sourceRow.key,
        ok: true,
        hostsCount: srcHosts.length,
        vpsesCount: srcVpses.length,
        partitionsCount: srcPartitions.length,
      };
    } catch (error) {
      if (error instanceof SourceUnavailableError) {
        this.logger.warn(`Sync failed for "${sourceRow.key}": ${error.message}`);
        await this.db
          .update(sources)
          .set({ lastSyncAt: now, lastSyncOk: false, lastSyncError: error.message })
          .where(eq(sources.key, sourceRow.key));
        return { sourceKey: sourceRow.key, ok: false, error: error.message };
      }
      // Not a connector problem (e.g. a DB error) - a real bug, don't hide it.
      throw error;
    }
  }

  private async syncHosts(sourceId: number, srcHosts: SourceHost[], now: Date): Promise<void> {
    for (const h of srcHosts) {
      await this.db
        .insert(hosts)
        .values({
          sourceId,
          sourceHostId: h.sourceHostId,
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

  private async syncPartitions(sourceId: number, srcPartitions: SourcePartition[], now: Date): Promise<void> {
    for (const p of srcPartitions) {
      const customerId = parseCustomerId(p.company);
      await this.db
        .insert(partitions)
        .values({
          sourceId,
          sourcePartitionId: p.sourcePartitionId,
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

  /** Maps a connector's own native id -> our own autoincrement id, for FK writes. */
  private async idMapFor(
    table: typeof hosts | typeof partitions,
    nativeIdField: "sourceHostId" | "sourcePartitionId",
    sourceId: number,
  ): Promise<Map<number, number>> {
    const nativeIdColumn =
      nativeIdField === "sourceHostId" ? hosts.sourceHostId : partitions.sourcePartitionId;
    const rows = await this.db
      .select({ id: table.id, nativeId: nativeIdColumn })
      .from(table as any)
      .where(eq((table as any).sourceId, sourceId));
    return new Map(rows.map((r: any) => [r.nativeId, r.id]));
  }

  private async syncVpses(
    sourceId: number,
    srcVpses: SourceVps[],
    hostIdBySourceHostId: Map<number, number>,
    partitionIdBySourcePartitionId: Map<number, number>,
    connectorType: ConnectorType,
    now: Date,
  ): Promise<void> {
    const existingRows = await this.db
      .select()
      .from(vpsInventory)
      .where(eq(vpsInventory.sourceId, sourceId));
    const existingBySourceVpsId = new Map(
      existingRows.map((r) => [r.sourceVpsId, r]),
    );
    const seenSourceVpsIds = new Set<number>();

    for (const vps of srcVpses) {
      seenSourceVpsIds.add(vps.sourceVpsId);
      const hostId = vps.hostId != null ? (hostIdBySourceHostId.get(vps.hostId) ?? null) : null;
      const partitionId =
        vps.partitionId != null ? (partitionIdBySourcePartitionId.get(vps.partitionId) ?? null) : null;
      const prior = existingBySourceVpsId.get(vps.sourceVpsId);

      let vpsInventoryId: number;

      if (!prior) {
        const [inserted] = await this.db.insert(vpsInventory).values({
          sourceId,
          sourceVpsId: vps.sourceVpsId,
          uuid: vps.uuid,
          hostId,
          partitionId,
          name: vps.name,
          engine: vps.engine,
          sourcePlatform: connectorType,
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
    // the source's list - mark removed, don't delete (keep history/audit).
    for (const [sourceVpsId, row] of existingBySourceVpsId) {
      if (!seenSourceVpsIds.has(sourceVpsId) && !row.isRemoved) {
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
