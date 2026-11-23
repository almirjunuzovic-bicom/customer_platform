import {
  BadRequestException,
  BadGatewayException,
  Body,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { and, asc, desc, eq, gte, isNull, lt, lte, or, sql } from "drizzle-orm";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ConnectorRegistryService } from "../connectors/connector-registry.service";
import { SourceUnavailableError } from "../connectors/connector.types";
import { SourcesService } from "../connectors/sources.service";
import { DATABASE, type Database } from "../db/database.module";
import { sources, vpsEvents, vpsInventory, vpsMetricsHistory, vpsMetricsRollup } from "../db/schema";

const VPS_ACTIONS = ["start", "stop", "restart"] as const;
type VpsAction = (typeof VPS_ACTIONS)[number];

// Matches SERVERware's own saga coordinator, which waits up to 120s for a
// completion/failure event per step (per apiagent-b6's source read) - our
// lock shouldn't expire sooner than SERVERware itself would still consider
// the operation in flight.
const PENDING_ACTION_TIMEOUT_MS = 120_000;

// Safety cap on the unbucketed /history path - without it, a call with no
// bucketSeconds and a wide/missing range could return every row ever
// recorded for a VPS (confirmed as a real risk in code review, not
// hypothetical: nothing previously stopped this).
const MAX_RAW_HISTORY_ROWS = 10_000;

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/**
 * Matches the rollup job's tiers exactly (see rollup/rollup.constants.ts) -
 * raw data genuinely doesn't exist past 1h anymore (rolled up + pruned),
 * then progressively coarser. `newestAgeMs`/`oldestAgeMs` are how old data
 * in this band is, measured from "now" - e.g. the 180s tier owns data
 * between 1h and 6h old.
 */
interface AgeBand {
  newestAgeMs: number;
  oldestAgeMs: number;
  /** null = raw table. */
  bucketSeconds: number | null;
}

const AGE_BANDS: AgeBand[] = [
  { newestAgeMs: 0, oldestAgeMs: HOUR_MS, bucketSeconds: null },
  { newestAgeMs: HOUR_MS, oldestAgeMs: 6 * HOUR_MS, bucketSeconds: 180 },
  { newestAgeMs: 6 * HOUR_MS, oldestAgeMs: DAY_MS, bucketSeconds: 600 },
  { newestAgeMs: DAY_MS, oldestAgeMs: WEEK_MS, bucketSeconds: 1800 },
  { newestAgeMs: WEEK_MS, oldestAgeMs: Infinity, bucketSeconds: 3600 },
];

interface TierSegment {
  bucketSeconds: number | null;
  from: Date;
  to: Date;
}

/**
 * Splits [fromDate, toDate] into the sub-ranges actually covered by each
 * age band, oldest-first - e.g. a "last 24h" query becomes 3 segments:
 * raw (last 1h), 180s tier (1h-6h ago), 600s tier (6h-24h ago).
 *
 * Replaced an earlier version that picked ONE tier for the whole query
 * based only on `from`'s age - confirmed live that this left recent data
 * missing entirely: the tier covering "24h ago" is, BY DEFINITION, data
 * that is itself around that age, so its newest row never reaches up to
 * "now" - querying only that one tier for a "last 24h" range produced
 * zero rows for most VPSes ("No history yet" on every one of them).
 * Stitching across every band the range actually overlaps is what a
 * "last N" query needs - each portion of the timeline rendered at
 * whatever resolution genuinely still exists for its own age, same
 * principle RRDtool/Graphite/Prometheus downsampling use.
 */
function planTierSegments(fromDate: Date, toDate: Date): TierSegment[] {
  const now = Date.now();
  const segments: TierSegment[] = [];
  for (const band of AGE_BANDS) {
    const bandNewestTime = new Date(now - band.newestAgeMs);
    const bandOldestTime = band.oldestAgeMs === Infinity ? new Date(0) : new Date(now - band.oldestAgeMs);
    const segFrom = bandOldestTime > fromDate ? bandOldestTime : fromDate;
    const segTo = bandNewestTime < toDate ? bandNewestTime : toDate;
    if (segFrom < segTo) {
      segments.push({ bucketSeconds: band.bucketSeconds, from: segFrom, to: segTo });
    }
  }
  return segments;
}

function parseIntParam(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new BadRequestException(`"${name}" must be an integer`);
  }
  return n;
}

interface SummaryAggregates {
  cpuPeak: number | null;
  cpuAvg: number | null;
  cpuMin: number | null;
  memPeak: number | null;
  memAvg: number | null;
  memMin: number | null;
  diskPeak: number | null;
  diskAvg: number | null;
  diskMin: number | null;
}

interface SummaryLatest {
  cpuUsage: number | null;
  memUsage: number | null;
  diskUsage: number | null;
}

function maxIgnoringNulls(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length > 0 ? Math.max(...present) : null;
}

function minIgnoringNulls(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length > 0 ? Math.min(...present) : null;
}

function avgIgnoringNulls(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  return present.length > 0 ? present.reduce((a, b) => a + b, 0) / present.length : null;
}

/**
 * Combines per-segment aggregates into one summary - peak/min stay exact
 * (max-of-max, min-of-min never lose precision), avg is an unweighted
 * average of each segment's own average (accepted imprecision, same
 * tradeoff as the rollup cascade's own avg-of-avg).
 */
function combineSegmentAggregates(segments: SummaryAggregates[]): SummaryAggregates {
  return {
    cpuPeak: maxIgnoringNulls(segments.map((s) => s.cpuPeak)),
    cpuAvg: avgIgnoringNulls(segments.map((s) => s.cpuAvg)),
    cpuMin: minIgnoringNulls(segments.map((s) => s.cpuMin)),
    memPeak: maxIgnoringNulls(segments.map((s) => s.memPeak)),
    memAvg: avgIgnoringNulls(segments.map((s) => s.memAvg)),
    memMin: minIgnoringNulls(segments.map((s) => s.memMin)),
    diskPeak: maxIgnoringNulls(segments.map((s) => s.diskPeak)),
    diskAvg: avgIgnoringNulls(segments.map((s) => s.diskAvg)),
    diskMin: minIgnoringNulls(segments.map((s) => s.diskMin)),
  };
}

function buildHistorySummary(aggregates: SummaryAggregates, latest: SummaryLatest | undefined) {
  return {
    cpuUsage: {
      peak: aggregates.cpuPeak,
      avg: aggregates.cpuAvg,
      min: aggregates.cpuMin,
      current: latest?.cpuUsage ?? null,
    },
    memUsage: {
      peak: aggregates.memPeak,
      avg: aggregates.memAvg,
      min: aggregates.memMin,
      current: latest?.memUsage ?? null,
    },
    diskUsage: {
      peak: aggregates.diskPeak,
      avg: aggregates.diskAvg,
      min: aggregates.diskMin,
      current: latest?.diskUsage ?? null,
    },
  };
}

interface UpdateVpsCustomerBody {
  customerId?: string | null;
  customerName?: string | null;
  hostingPackage?: string | null;
  notificationEmails?: string[] | null;
}

function parseDateParam(value: string, name: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`"${name}" is not a valid date`);
  }
  return date;
}

@Controller("vps")
@UseGuards(JwtAuthGuard)
export class VpsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ConnectorRegistryService) private readonly connectorRegistry: ConnectorRegistryService,
    @Inject(SourcesService) private readonly sourcesService: SourcesService,
  ) {}

  @Get()
  async list(
    @Query("sourceId") sourceId?: string,
    @Query("partitionId") partitionId?: string,
    @Query("includeRemoved") includeRemoved?: string,
  ) {
    const conditions = [];
    if (sourceId) {
      conditions.push(eq(vpsInventory.sourceId, parseIntParam(sourceId, "sourceId")));
    }
    if (partitionId) {
      conditions.push(
        eq(vpsInventory.partitionId, parseIntParam(partitionId, "partitionId")),
      );
    }
    if (includeRemoved !== "true") {
      conditions.push(eq(vpsInventory.isRemoved, false));
    }

    return this.db
      .select()
      .from(vpsInventory)
      .where(conditions.length ? and(...conditions) : undefined);
  }

  @Get(":id")
  async get(@Param("id") id: string) {
    const vpsId = parseIntParam(id, "id");
    const [row] = await this.db
      .select()
      .from(vpsInventory)
      .where(eq(vpsInventory.id, vpsId))
      .limit(1);
    if (!row) throw new NotFoundException(`No VPS with id ${vpsId}`);
    return row;
  }

  /**
   * Fetches raw rows grouped into bucketSecondsNum-wide buckets, restricted
   * to [from, to] - shared by the no-`from` bucketed path and each raw
   * segment of a stitched multi-tier query below.
   */
  private async queryRawBucketed(
    vpsId: number,
    from: Date | undefined,
    to: Date | undefined,
    bucketSecondsNum: number,
  ) {
    const conditions = [eq(vpsMetricsHistory.vpsInventoryId, vpsId)];
    if (from) conditions.push(gte(vpsMetricsHistory.capturedAt, from));
    if (to) conditions.push(lte(vpsMetricsHistory.capturedAt, to));
    // FLOOR(UNIX_TIMESTAMP(...) / N) * N buckets every row into an N-second
    // window; MySQL (not Postgres) has no native time_bucket, this is the
    // standard equivalent.
    const bucket = sql<Date>`FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(${vpsMetricsHistory.capturedAt}) / ${bucketSecondsNum}) * ${bucketSecondsNum})`;
    return this.db
      .select({
        capturedAt: bucket.as("captured_at"),
        state: sql<string>`MAX(${vpsMetricsHistory.state})`.as("state"),
        cpuUsage: sql<number | null>`AVG(${vpsMetricsHistory.cpuUsage})`.as("cpu_usage"),
        memUsage: sql<number | null>`AVG(${vpsMetricsHistory.memUsage})`.as("mem_usage"),
        diskUsage: sql<number | null>`AVG(${vpsMetricsHistory.diskUsage})`.as("disk_usage"),
        ccCount: sql<number | null>`AVG(${vpsMetricsHistory.ccCount})`.as("cc_count"),
        uptimeSeconds: sql<number | null>`MAX(${vpsMetricsHistory.uptimeSeconds})`.as(
          "uptime_seconds",
        ),
      })
      .from(vpsMetricsHistory)
      .where(and(...conditions))
      .groupBy(bucket)
      .orderBy(asc(bucket));
  }

  /**
   * Raw 10s data only exists for the last ~1h (rolled up + pruned beyond
   * that, see rollup/rollup.service.ts). A `from` reaching further back is
   * stitched together from whichever rollup tier(s) actually cover each
   * part of the range (see planTierSegments) - each segment at its own
   * tier's native resolution; client `bucketSeconds` is only honored
   * within a still-raw segment (it can't ask for finer than a tier's
   * stored resolution once the range falls there, because finer data
   * genuinely doesn't exist anymore). See history/summary for exact
   * (non-bucketed, tier-aware) peak/avg/min/current - deliberately
   * separate so a coarse bucket never affects those numbers.
   */
  @Get(":id/history")
  async history(
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("bucketSeconds") bucketSeconds?: string,
  ) {
    const vpsId = parseIntParam(id, "id");
    const fromDate = from ? parseDateParam(from, "from") : undefined;
    const toDate = to ? parseDateParam(to, "to") : undefined;
    const bucketSecondsNum = bucketSeconds ? parseIntParam(bucketSeconds, "bucketSeconds") : undefined;
    if (bucketSecondsNum !== undefined && bucketSecondsNum < 10) {
      throw new BadRequestException(`"bucketSeconds" must be >= 10 (the poller's own tick)`);
    }

    if (!fromDate) {
      // No lower bound - single raw query, same as before this feature.
      if (!bucketSecondsNum) {
        // Most-recent-N, not oldest-N - a plain ascending LIMIT would cut
        // off the newest data instead of the oldest, backwards for a
        // monitoring chart. Capped regardless of to, not just when it's
        // also missing - a wide explicit range is the same risk (though
        // now self-limiting anyway once raw-tier pruning has run).
        const conditions = [eq(vpsMetricsHistory.vpsInventoryId, vpsId)];
        if (toDate) conditions.push(lte(vpsMetricsHistory.capturedAt, toDate));
        const rows = await this.db
          .select()
          .from(vpsMetricsHistory)
          .where(and(...conditions))
          .orderBy(desc(vpsMetricsHistory.capturedAt))
          .limit(MAX_RAW_HISTORY_ROWS);
        return rows.reverse();
      }
      return this.queryRawBucketed(vpsId, undefined, toDate, bucketSecondsNum);
    }

    const segments = planTierSegments(fromDate, toDate ?? new Date());
    const result: Array<{
      capturedAt: Date | string;
      state: string;
      cpuUsage: number | null;
      memUsage: number | null;
      diskUsage: number | null;
      ccCount: number | null;
      uptimeSeconds: number | null;
    }> = [];
    for (const segment of segments) {
      if (segment.bucketSeconds === null) {
        // Default smoothing (60s) when the caller didn't ask for a
        // specific one but the overall range extends beyond raw-only -
        // avoids this segment being far denser than its neighbors.
        const rows = await this.queryRawBucketed(vpsId, segment.from, segment.to, bucketSecondsNum ?? 60);
        result.push(...rows);
      } else {
        const rows = await this.db
          .select({
            capturedAt: vpsMetricsRollup.bucketStart,
            state: sql<string>`''`.as("state"), // not tracked per-bucket in the rollup tiers
            cpuUsage: vpsMetricsRollup.cpuUsageAvg,
            memUsage: vpsMetricsRollup.memUsageAvg,
            diskUsage: vpsMetricsRollup.diskUsageAvg,
            ccCount: vpsMetricsRollup.ccCountAvg,
            uptimeSeconds: vpsMetricsRollup.uptimeSecondsMax,
          })
          .from(vpsMetricsRollup)
          .where(
            and(
              eq(vpsMetricsRollup.vpsInventoryId, vpsId),
              eq(vpsMetricsRollup.bucketSeconds, segment.bucketSeconds),
              gte(vpsMetricsRollup.bucketStart, segment.from),
              lte(vpsMetricsRollup.bucketStart, segment.to),
            ),
          )
          .orderBy(asc(vpsMetricsRollup.bucketStart));
        result.push(...rows);
      }
    }
    return result;
  }

  /**
   * Exact peak/average/min/current for the given range - stitched across
   * whatever tiers the range spans (see history/planTierSegments above,
   * same reasoning: picking one tier for the whole range missed real data).
   * peak/min stay exact at every tier, since each rollup bucket keeps its
   * own max/min, not just an average (see schema.ts vpsMetricsRollup) - an
   * average-of-averages would have understated a real spike, exactly what
   * this endpoint exists to avoid. avg here is an unweighted average of
   * per-segment averages - accepted imprecision, same as the rollup
   * cascade's own avg-of-avg (see rollup.service.ts).
   */
  @Get(":id/history/summary")
  async historySummary(
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const vpsId = parseIntParam(id, "id");
    const fromDate = from ? parseDateParam(from, "from") : undefined;
    const toDate = to ? parseDateParam(to, "to") : undefined;

    if (!fromDate) {
      const conditions = [eq(vpsMetricsHistory.vpsInventoryId, vpsId)];
      if (toDate) conditions.push(lte(vpsMetricsHistory.capturedAt, toDate));

      const [aggregates] = await this.db
        .select({
          cpuPeak: sql<number | null>`MAX(${vpsMetricsHistory.cpuUsage})`,
          cpuAvg: sql<number | null>`AVG(${vpsMetricsHistory.cpuUsage})`,
          cpuMin: sql<number | null>`MIN(${vpsMetricsHistory.cpuUsage})`,
          memPeak: sql<number | null>`MAX(${vpsMetricsHistory.memUsage})`,
          memAvg: sql<number | null>`AVG(${vpsMetricsHistory.memUsage})`,
          memMin: sql<number | null>`MIN(${vpsMetricsHistory.memUsage})`,
          diskPeak: sql<number | null>`MAX(${vpsMetricsHistory.diskUsage})`,
          diskAvg: sql<number | null>`AVG(${vpsMetricsHistory.diskUsage})`,
          diskMin: sql<number | null>`MIN(${vpsMetricsHistory.diskUsage})`,
        })
        .from(vpsMetricsHistory)
        .where(and(...conditions));
      const [latestRow] = await this.db
        .select({
          cpuUsage: vpsMetricsHistory.cpuUsage,
          memUsage: vpsMetricsHistory.memUsage,
          diskUsage: vpsMetricsHistory.diskUsage,
        })
        .from(vpsMetricsHistory)
        .where(and(...conditions))
        .orderBy(desc(vpsMetricsHistory.capturedAt))
        .limit(1);
      return buildHistorySummary(aggregates, latestRow);
    }

    const segments = planTierSegments(fromDate, toDate ?? new Date());
    const perSegment: SummaryAggregates[] = [];
    let latest: SummaryLatest | undefined;
    let latestTime = -Infinity;

    for (const segment of segments) {
      if (segment.bucketSeconds === null) {
        const conditions = [
          eq(vpsMetricsHistory.vpsInventoryId, vpsId),
          gte(vpsMetricsHistory.capturedAt, segment.from),
          lte(vpsMetricsHistory.capturedAt, segment.to),
        ];
        const [aggregates] = await this.db
          .select({
            cpuPeak: sql<number | null>`MAX(${vpsMetricsHistory.cpuUsage})`,
            cpuAvg: sql<number | null>`AVG(${vpsMetricsHistory.cpuUsage})`,
            cpuMin: sql<number | null>`MIN(${vpsMetricsHistory.cpuUsage})`,
            memPeak: sql<number | null>`MAX(${vpsMetricsHistory.memUsage})`,
            memAvg: sql<number | null>`AVG(${vpsMetricsHistory.memUsage})`,
            memMin: sql<number | null>`MIN(${vpsMetricsHistory.memUsage})`,
            diskPeak: sql<number | null>`MAX(${vpsMetricsHistory.diskUsage})`,
            diskAvg: sql<number | null>`AVG(${vpsMetricsHistory.diskUsage})`,
            diskMin: sql<number | null>`MIN(${vpsMetricsHistory.diskUsage})`,
          })
          .from(vpsMetricsHistory)
          .where(and(...conditions));
        perSegment.push(aggregates);

        const [row] = await this.db
          .select({
            capturedAt: vpsMetricsHistory.capturedAt,
            cpuUsage: vpsMetricsHistory.cpuUsage,
            memUsage: vpsMetricsHistory.memUsage,
            diskUsage: vpsMetricsHistory.diskUsage,
          })
          .from(vpsMetricsHistory)
          .where(and(...conditions))
          .orderBy(desc(vpsMetricsHistory.capturedAt))
          .limit(1);
        if (row && new Date(row.capturedAt).getTime() > latestTime) {
          latestTime = new Date(row.capturedAt).getTime();
          latest = row;
        }
      } else {
        const conditions = [
          eq(vpsMetricsRollup.vpsInventoryId, vpsId),
          eq(vpsMetricsRollup.bucketSeconds, segment.bucketSeconds),
          gte(vpsMetricsRollup.bucketStart, segment.from),
          lte(vpsMetricsRollup.bucketStart, segment.to),
        ];
        const [aggregates] = await this.db
          .select({
            cpuPeak: sql<number | null>`MAX(${vpsMetricsRollup.cpuUsageMax})`,
            cpuAvg: sql<number | null>`AVG(${vpsMetricsRollup.cpuUsageAvg})`,
            cpuMin: sql<number | null>`MIN(${vpsMetricsRollup.cpuUsageMin})`,
            memPeak: sql<number | null>`MAX(${vpsMetricsRollup.memUsageMax})`,
            memAvg: sql<number | null>`AVG(${vpsMetricsRollup.memUsageAvg})`,
            memMin: sql<number | null>`MIN(${vpsMetricsRollup.memUsageMin})`,
            diskPeak: sql<number | null>`MAX(${vpsMetricsRollup.diskUsageMax})`,
            diskAvg: sql<number | null>`AVG(${vpsMetricsRollup.diskUsageAvg})`,
            diskMin: sql<number | null>`MIN(${vpsMetricsRollup.diskUsageMin})`,
          })
          .from(vpsMetricsRollup)
          .where(and(...conditions));
        perSegment.push(aggregates);

        // "current" from a rollup segment is that bucket's average, not a
        // true instantaneous value - genuinely the best available once raw
        // data for this range is gone, not an approximation chosen over
        // something better.
        const [row] = await this.db
          .select({
            capturedAt: vpsMetricsRollup.bucketStart,
            cpuUsage: vpsMetricsRollup.cpuUsageAvg,
            memUsage: vpsMetricsRollup.memUsageAvg,
            diskUsage: vpsMetricsRollup.diskUsageAvg,
          })
          .from(vpsMetricsRollup)
          .where(and(...conditions))
          .orderBy(desc(vpsMetricsRollup.bucketStart))
          .limit(1);
        if (row && new Date(row.capturedAt).getTime() > latestTime) {
          latestTime = new Date(row.capturedAt).getTime();
          latest = row;
        }
      }
    }

    return buildHistorySummary(combineSegmentAggregates(perSegment), latest);
  }

  @Get(":id/events")
  async events(@Param("id") id: string) {
    const vpsId = parseIntParam(id, "id");
    return this.db
      .select()
      .from(vpsEvents)
      .where(eq(vpsEvents.vpsInventoryId, vpsId))
      .orderBy(vpsEvents.detectedAt);
  }

  /**
   * Manual customer/billing annotations - see schema.ts vpsInventory
   * comment. Exists on every VPS regardless of connectorType: AWS has no
   * partition/tenant concept to derive these from at all, so manual entry
   * is the only option for it today; SERVERware VPSes can already be
   * auto-populated from their partition later (deferred, not built yet),
   * but can still be manually overridden here in the meantime. No Roles
   * guard, same as performAction below - any authenticated user can edit,
   * not admin-only.
   */
  @Patch(":id/customer")
  async updateCustomer(@Param("id") id: string, @Body() body: UpdateVpsCustomerBody) {
    const vpsId = parseIntParam(id, "id");
    const [vps] = await this.db
      .select({ id: vpsInventory.id })
      .from(vpsInventory)
      .where(eq(vpsInventory.id, vpsId))
      .limit(1);
    if (!vps) throw new NotFoundException(`No VPS with id ${vpsId}`);

    if (
      body.notificationEmails != null &&
      (!Array.isArray(body.notificationEmails) ||
        body.notificationEmails.some((e) => typeof e !== "string"))
    ) {
      throw new BadRequestException(`"notificationEmails" must be an array of strings`);
    }

    const update: Partial<typeof vpsInventory.$inferInsert> = {};
    if (body.customerId !== undefined) update.customerId = body.customerId;
    if (body.customerName !== undefined) update.customerName = body.customerName;
    if (body.hostingPackage !== undefined) update.hostingPackage = body.hostingPackage;
    if (body.notificationEmails !== undefined) update.notificationEmails = body.notificationEmails;

    await this.db.update(vpsInventory).set(update).where(eq(vpsInventory.id, vpsId));
    const [updated] = await this.db
      .select()
      .from(vpsInventory)
      .where(eq(vpsInventory.id, vpsId))
      .limit(1);

    // Write-through: a connector that backs these fields with its own
    // storage (AWS: Lightsail tags) pushes the new values out so its
    // console and this platform agree either direction - see
    // AwsLightsailService.pushCustomerInfo. Connectors without this
    // (SERVERware, Proxmox) just skip it - stays manual-only for them.
    // The local save above already committed regardless, so a push
    // failure is reported as a warning, not a hard error - the next sync
    // would reconcile it from the source's own current value anyway.
    let pushWarning: string | null = null;
    try {
      const resolved = await this.sourcesService.resolve(updated.sourceId);
      const connector = this.connectorRegistry.get(resolved.connectorType);
      await connector.pushCustomerInfo?.(resolved, updated, {
        customerId: updated.customerId,
        customerName: updated.customerName,
        hostingPackage: updated.hostingPackage,
        notificationEmails: updated.notificationEmails,
      });
    } catch (error) {
      pushWarning =
        error instanceof SourceUnavailableError ? error.message : String(error);
    }

    return { ...updated, pushWarning };
  }

  /**
   * Fires the action and returns immediately once the source has accepted
   * it - this does NOT mean the VPS has actually changed state yet. Per
   * SERVERWARE_API.md §0 ("never assume state changed just because this
   * platform sent a call"), the real confirmation is the next poller tick
   * (<=10s) writing a state_changed event. The action_requested event
   * recorded here is what ties that later change back to this user.
   */
  @Post(":id/actions/:action")
  async performAction(
    @Param("id") id: string,
    @Param("action") action: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!VPS_ACTIONS.includes(action as VpsAction)) {
      throw new BadRequestException(
        `"action" must be one of: ${VPS_ACTIONS.join(", ")}`,
      );
    }
    const vpsId = parseIntParam(id, "id");

    const [vps] = await this.db
      .select()
      .from(vpsInventory)
      .where(eq(vpsInventory.id, vpsId))
      .limit(1);
    if (!vps || vps.isRemoved) {
      throw new NotFoundException(`No VPS with id ${vpsId}`);
    }

    const [sourceRow] = await this.db
      .select({ id: sources.id })
      .from(sources)
      .where(eq(sources.id, vps.sourceId))
      .limit(1);
    if (!sourceRow) {
      throw new NotFoundException(`No source for VPS ${vpsId}`);
    }

    // The source's own guard: SERVERware 400s start/stop/restart while some
    // OTHER task is in progress (confirmed live - see hst2171-serverware-api).
    // Check it ourselves first so we don't even make the call.
    if (vps.task) {
      throw new ConflictException(
        `Operation already in progress on this VPS: ${vps.task}`,
      );
    }

    // Our OWN lock - start/stop/restart don't set SERVERware's `task`
    // themselves, so without this, two users (or one double-click) could
    // both fire the same action before our 10s poller shows anything
    // different. Atomic conditional UPDATE: only succeeds if nobody else
    // holds the lock, or their lock is stale (see PENDING_ACTION_TIMEOUT_MS).
    const now = new Date();
    const staleBefore = new Date(now.getTime() - PENDING_ACTION_TIMEOUT_MS);
    const lockResult = await this.db
      .update(vpsInventory)
      .set({ pendingAction: action, pendingActionAt: now })
      .where(
        and(
          eq(vpsInventory.id, vpsId),
          or(isNull(vpsInventory.pendingAction), lt(vpsInventory.pendingActionAt, staleBefore)),
        ),
      );
    if (lockResult[0].affectedRows === 0) {
      throw new ConflictException(
        "Another start/stop/restart is already in progress on this VPS",
      );
    }

    await this.db.insert(vpsEvents).values({
      vpsInventoryId: vpsId,
      eventType: "action_requested",
      previousValue: null,
      newValue: action,
      detectedAt: now,
      source: "platform_action",
      actorUserId: actor.id,
    });

    try {
      const resolved = await this.sourcesService.resolve(vps.sourceId);
      const connector = this.connectorRegistry.get(resolved.connectorType);
      const typedAction = action as VpsAction;
      if (typedAction === "start") {
        await connector.startVps(resolved, vps);
      } else if (typedAction === "stop") {
        await connector.stopVps(resolved, vps);
      } else {
        await connector.restartVps(resolved, vps);
      }
    } catch (error) {
      // The call never actually landed on the source's side - release our
      // lock immediately instead of blocking retries for the full timeout.
      await this.db
        .update(vpsInventory)
        .set({ pendingAction: null, pendingActionAt: null })
        .where(eq(vpsInventory.id, vpsId));
      if (error instanceof SourceUnavailableError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }

    return { status: "requested", action, vpsId };
  }
}
