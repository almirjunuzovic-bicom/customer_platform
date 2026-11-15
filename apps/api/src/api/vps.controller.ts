import {
  BadRequestException,
  BadGatewayException,
  ConflictException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
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
// Matches the rollup job's tiers exactly (see rollup/rollup.constants.ts) -
// raw data genuinely doesn't exist past 1h anymore (rolled up + pruned),
// so a query reaching further back MUST read from the matching rollup
// tier instead. Each entry: "if the request reaches back at most this far,
// use this bucket size" - checked in order, first match wins.
const TIER_BOUNDARIES: { upToMs: number; bucketSeconds: number }[] = [
  { upToMs: 6 * HOUR_MS, bucketSeconds: 180 }, // 1h-6h old -> 3min tier
  { upToMs: 24 * HOUR_MS, bucketSeconds: 600 }, // 6h-24h old -> 10min tier
  { upToMs: 7 * 24 * HOUR_MS, bucketSeconds: 1800 }, // 24h-7d old -> 30min tier
];
const OLDEST_TIER_BUCKET_SECONDS = 3600; // 7d+ old -> 1h tier, kept forever

/** null = raw table still has this range (within the last 1h), no `from` given, or `from` is in the future. */
function pickRollupTier(fromDate: Date | undefined): number | null {
  if (!fromDate) return null;
  const age = Date.now() - fromDate.getTime();
  if (age <= HOUR_MS) return null;
  for (const tier of TIER_BOUNDARIES) {
    if (age <= tier.upToMs) return tier.bucketSeconds;
  }
  return OLDEST_TIER_BUCKET_SECONDS;
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
   * Raw 10s data only exists for the last ~1h (rolled up + pruned beyond
   * that, see rollup/rollup.service.ts) - a `from` reaching further back
   * is served from the matching rollup tier instead, at that tier's native
   * resolution (client `bucketSeconds` is advisory for the still-raw <1h
   * path only; it can't ask for finer than a tier's stored resolution once
   * the range falls there, because finer data genuinely doesn't exist
   * anymore). See history/summary for exact (non-bucketed, tier-aware)
   * peak/avg/min/current - deliberately separate so a coarse bucket never
   * affects those numbers.
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
    const tier = pickRollupTier(fromDate);

    if (tier !== null) {
      const conditions = [
        eq(vpsMetricsRollup.vpsInventoryId, vpsId),
        eq(vpsMetricsRollup.bucketSeconds, tier),
      ];
      if (fromDate) conditions.push(gte(vpsMetricsRollup.bucketStart, fromDate));
      if (toDate) conditions.push(lte(vpsMetricsRollup.bucketStart, toDate));
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
        .where(and(...conditions))
        .orderBy(asc(vpsMetricsRollup.bucketStart));
      return rows;
    }

    const conditions = [eq(vpsMetricsHistory.vpsInventoryId, vpsId)];
    if (fromDate) conditions.push(gte(vpsMetricsHistory.capturedAt, fromDate));
    if (toDate) conditions.push(lte(vpsMetricsHistory.capturedAt, toDate));

    if (!bucketSeconds) {
      // Most-recent-N, not oldest-N - a plain ascending LIMIT would cut off
      // the newest data instead of the oldest, which is backwards for a
      // monitoring chart. Capped regardless of from/to, not just when both
      // are missing - a wide explicit range is the same risk (though now
      // self-limiting anyway once raw-tier pruning has run).
      const rows = await this.db
        .select()
        .from(vpsMetricsHistory)
        .where(and(...conditions))
        .orderBy(desc(vpsMetricsHistory.capturedAt))
        .limit(MAX_RAW_HISTORY_ROWS);
      return rows.reverse();
    }

    const bucketSecondsNum = parseIntParam(bucketSeconds, "bucketSeconds");
    if (bucketSecondsNum < 10) {
      throw new BadRequestException(`"bucketSeconds" must be >= 10 (the poller's own tick)`);
    }
    // FLOOR(UNIX_TIMESTAMP(...) / N) * N buckets every row into an N-second
    // window; MySQL (not Postgres) has no native time_bucket, this is the
    // standard equivalent.
    const bucket = sql`FROM_UNIXTIME(FLOOR(UNIX_TIMESTAMP(${vpsMetricsHistory.capturedAt}) / ${bucketSecondsNum}) * ${bucketSecondsNum})`;
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
   * Exact peak/average/min/current for the given range, computed as a
   * single SQL aggregate pass. Reads from the matching rollup tier once
   * `from` reaches past raw's ~1h retention (see history above) - peak/min
   * stay exact there too, since each rollup bucket keeps its own max/min,
   * not just an average (see schema.ts vpsMetricsRollup) - an average-of-
   * averages would have understated a real spike, exactly what this
   * endpoint exists to avoid.
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
    const tier = pickRollupTier(fromDate);

    if (tier !== null) {
      const conditions = [
        eq(vpsMetricsRollup.vpsInventoryId, vpsId),
        eq(vpsMetricsRollup.bucketSeconds, tier),
      ];
      if (fromDate) conditions.push(gte(vpsMetricsRollup.bucketStart, fromDate));
      if (toDate) conditions.push(lte(vpsMetricsRollup.bucketStart, toDate));

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

      // "current" is the latest bucket's average, not a true instantaneous
      // value - that's genuinely the best available once raw data for this
      // range is gone, not an approximation we chose over something better.
      const [latest] = await this.db
        .select({
          cpuUsage: vpsMetricsRollup.cpuUsageAvg,
          memUsage: vpsMetricsRollup.memUsageAvg,
          diskUsage: vpsMetricsRollup.diskUsageAvg,
        })
        .from(vpsMetricsRollup)
        .where(and(...conditions))
        .orderBy(desc(vpsMetricsRollup.bucketStart))
        .limit(1);

      return buildHistorySummary(aggregates, latest);
    }

    const conditions = [eq(vpsMetricsHistory.vpsInventoryId, vpsId)];
    if (fromDate) conditions.push(gte(vpsMetricsHistory.capturedAt, fromDate));
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

    const [latest] = await this.db
      .select({
        cpuUsage: vpsMetricsHistory.cpuUsage,
        memUsage: vpsMetricsHistory.memUsage,
        diskUsage: vpsMetricsHistory.diskUsage,
      })
      .from(vpsMetricsHistory)
      .where(and(...conditions))
      .orderBy(desc(vpsMetricsHistory.capturedAt))
      .limit(1);

    return buildHistorySummary(aggregates, latest);
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
        await connector.startVps(resolved, vps.sourceVpsId);
      } else if (typedAction === "stop") {
        await connector.stopVps(resolved, vps.sourceVpsId);
      } else {
        await connector.restartVps(resolved, vps.sourceVpsId);
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
