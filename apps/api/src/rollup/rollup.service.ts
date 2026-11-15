import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq, lt, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../db/database.module";
import { vpsMetricsHistory, vpsMetricsRollup } from "../db/schema";
import { ROLLUP_TIERS } from "./rollup.constants";

interface AggregatedBucket {
  vpsInventoryId: number;
  bucketStart: Date | string;
  cpuUsageAvg: number | null;
  cpuUsageMax: number | null;
  cpuUsageMin: number | null;
  memUsageAvg: number | null;
  memUsageMax: number | null;
  memUsageMin: number | null;
  diskUsageAvg: number | null;
  diskUsageMax: number | null;
  diskUsageMin: number | null;
  ccCountAvg: number | null;
  uptimeSecondsMax: number | null;
}

/**
 * Cascading tiered rollup: raw (10s, kept 1h) -> 3min (kept 6h) -> 10min
 * (kept 24h) -> 30min (kept 7d) -> 1h (kept forever). Each run only
 * processes whatever has newly aged past a tier's threshold since the last
 * run - bounded work per run, not a full-table scan every time. Averages
 * cascade from the previous tier's averages past the first hop (raw is
 * gone by the time data reaches the 600s tier) - accepted imprecision for
 * a monitoring rollup, see schema.ts.
 */
@Injectable()
export class RollupService {
  private readonly logger = new Logger(RollupService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async run(): Promise<void> {
    for (const tier of ROLLUP_TIERS) {
      if (tier.sourceBucketSeconds === null) {
        await this.rollupFromRaw(tier.bucketSeconds, tier.olderThanSeconds);
      } else {
        await this.rollupFromTier(tier.sourceBucketSeconds, tier.bucketSeconds, tier.olderThanSeconds);
      }
    }
  }

  private async rollupFromRaw(bucketSeconds: number, olderThanSeconds: number): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
    const bucket = sql`FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(${vpsMetricsHistory.capturedAt}) / ${bucketSeconds}) * ${bucketSeconds})`;

    const rows = (await this.db
      .select({
        vpsInventoryId: vpsMetricsHistory.vpsInventoryId,
        bucketStart: bucket.as("bucket_start"),
        cpuUsageAvg: sql<number | null>`AVG(${vpsMetricsHistory.cpuUsage})`,
        cpuUsageMax: sql<number | null>`MAX(${vpsMetricsHistory.cpuUsage})`,
        cpuUsageMin: sql<number | null>`MIN(${vpsMetricsHistory.cpuUsage})`,
        memUsageAvg: sql<number | null>`AVG(${vpsMetricsHistory.memUsage})`,
        memUsageMax: sql<number | null>`MAX(${vpsMetricsHistory.memUsage})`,
        memUsageMin: sql<number | null>`MIN(${vpsMetricsHistory.memUsage})`,
        diskUsageAvg: sql<number | null>`AVG(${vpsMetricsHistory.diskUsage})`,
        diskUsageMax: sql<number | null>`MAX(${vpsMetricsHistory.diskUsage})`,
        diskUsageMin: sql<number | null>`MIN(${vpsMetricsHistory.diskUsage})`,
        ccCountAvg: sql<number | null>`AVG(${vpsMetricsHistory.ccCount})`,
        uptimeSecondsMax: sql<number | null>`MAX(${vpsMetricsHistory.uptimeSeconds})`,
      })
      .from(vpsMetricsHistory)
      .where(lt(vpsMetricsHistory.capturedAt, cutoff))
      .groupBy(vpsMetricsHistory.vpsInventoryId, bucket)) as AggregatedBucket[];

    await this.upsertBuckets(bucketSeconds, rows);
    await this.db.delete(vpsMetricsHistory).where(lt(vpsMetricsHistory.capturedAt, cutoff));

    if (rows.length > 0) {
      this.logger.log(
        `Rolled up ${rows.length} bucket(s) raw -> ${bucketSeconds}s, pruned raw rows older than ${cutoff.toISOString()}`,
      );
    }
  }

  private async rollupFromTier(
    sourceBucketSeconds: number,
    targetBucketSeconds: number,
    olderThanSeconds: number,
  ): Promise<void> {
    const cutoff = new Date(Date.now() - olderThanSeconds * 1000);
    const bucket = sql`FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(${vpsMetricsRollup.bucketStart}) / ${targetBucketSeconds}) * ${targetBucketSeconds})`;

    const rows = (await this.db
      .select({
        vpsInventoryId: vpsMetricsRollup.vpsInventoryId,
        bucketStart: bucket.as("bucket_start"),
        cpuUsageAvg: sql<number | null>`AVG(${vpsMetricsRollup.cpuUsageAvg})`,
        // Max-of-max/min-of-min cascades exactly (no precision loss),
        // unlike avg-of-avg - same reasoning as uptimeSecondsMax below.
        cpuUsageMax: sql<number | null>`MAX(${vpsMetricsRollup.cpuUsageMax})`,
        cpuUsageMin: sql<number | null>`MIN(${vpsMetricsRollup.cpuUsageMin})`,
        memUsageAvg: sql<number | null>`AVG(${vpsMetricsRollup.memUsageAvg})`,
        memUsageMax: sql<number | null>`MAX(${vpsMetricsRollup.memUsageMax})`,
        memUsageMin: sql<number | null>`MIN(${vpsMetricsRollup.memUsageMin})`,
        diskUsageAvg: sql<number | null>`AVG(${vpsMetricsRollup.diskUsageAvg})`,
        diskUsageMax: sql<number | null>`MAX(${vpsMetricsRollup.diskUsageMax})`,
        diskUsageMin: sql<number | null>`MIN(${vpsMetricsRollup.diskUsageMin})`,
        ccCountAvg: sql<number | null>`AVG(${vpsMetricsRollup.ccCountAvg})`,
        uptimeSecondsMax: sql<number | null>`MAX(${vpsMetricsRollup.uptimeSecondsMax})`,
      })
      .from(vpsMetricsRollup)
      .where(and(eq(vpsMetricsRollup.bucketSeconds, sourceBucketSeconds), lt(vpsMetricsRollup.bucketStart, cutoff)))
      .groupBy(vpsMetricsRollup.vpsInventoryId, bucket)) as AggregatedBucket[];

    await this.upsertBuckets(targetBucketSeconds, rows);
    await this.db
      .delete(vpsMetricsRollup)
      .where(and(eq(vpsMetricsRollup.bucketSeconds, sourceBucketSeconds), lt(vpsMetricsRollup.bucketStart, cutoff)));

    if (rows.length > 0) {
      this.logger.log(
        `Rolled up ${rows.length} bucket(s) ${sourceBucketSeconds}s -> ${targetBucketSeconds}s, pruned source rows older than ${cutoff.toISOString()}`,
      );
    }
  }

  private async upsertBuckets(bucketSeconds: number, rows: AggregatedBucket[]): Promise<void> {
    for (const row of rows) {
      const values = {
        vpsInventoryId: row.vpsInventoryId,
        bucketSeconds,
        bucketStart: new Date(row.bucketStart),
        cpuUsageAvg: row.cpuUsageAvg,
        cpuUsageMax: row.cpuUsageMax,
        cpuUsageMin: row.cpuUsageMin,
        memUsageAvg: row.memUsageAvg,
        memUsageMax: row.memUsageMax,
        memUsageMin: row.memUsageMin,
        diskUsageAvg: row.diskUsageAvg,
        diskUsageMax: row.diskUsageMax,
        diskUsageMin: row.diskUsageMin,
        ccCountAvg: row.ccCountAvg,
        uptimeSecondsMax: row.uptimeSecondsMax,
      };
      await this.db
        .insert(vpsMetricsRollup)
        .values(values)
        .onDuplicateKeyUpdate({
          set: {
            cpuUsageAvg: values.cpuUsageAvg,
            cpuUsageMax: values.cpuUsageMax,
            cpuUsageMin: values.cpuUsageMin,
            memUsageAvg: values.memUsageAvg,
            memUsageMax: values.memUsageMax,
            memUsageMin: values.memUsageMin,
            diskUsageAvg: values.diskUsageAvg,
            diskUsageMax: values.diskUsageMax,
            diskUsageMin: values.diskUsageMin,
            ccCountAvg: values.ccCountAvg,
            uptimeSecondsMax: values.uptimeSecondsMax,
          },
        });
    }
  }
}
