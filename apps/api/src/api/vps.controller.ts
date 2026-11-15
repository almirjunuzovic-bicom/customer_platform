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
import { sources, vpsEvents, vpsInventory, vpsMetricsHistory } from "../db/schema";

const VPS_ACTIONS = ["start", "stop", "restart"] as const;
type VpsAction = (typeof VPS_ACTIONS)[number];

// Matches SERVERware's own saga coordinator, which waits up to 120s for a
// completion/failure event per step (per apiagent-b6's source read) - our
// lock shouldn't expire sooner than SERVERware itself would still consider
// the operation in flight.
const PENDING_ACTION_TIMEOUT_MS = 120_000;

function parseIntParam(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new BadRequestException(`"${name}" must be an integer`);
  }
  return n;
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
   * Without `bucketSeconds`: raw rows (unbounded - callers own range-scoping
   * it). With it: one averaged row per bucket, computed in SQL - added
   * after confirming live that "7 days"/"All" in the frontend's Details
   * dialog was fetching and parsing tens of thousands of raw rows just to
   * downsample them client-side, which only fixed the chart's render cost,
   * not the network/DB cost of hauling every row over in the first place.
   * See history/summary for exact (non-bucketed) peak/avg/min/current -
   * that's a separate SQL aggregate, deliberately NOT derived from these
   * averaged buckets, which would already have smoothed real spikes away.
   */
  @Get(":id/history")
  async history(
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("bucketSeconds") bucketSeconds?: string,
  ) {
    const vpsId = parseIntParam(id, "id");
    const conditions = [eq(vpsMetricsHistory.vpsInventoryId, vpsId)];

    if (from) conditions.push(gte(vpsMetricsHistory.capturedAt, parseDateParam(from, "from")));
    if (to) conditions.push(lte(vpsMetricsHistory.capturedAt, parseDateParam(to, "to")));

    if (!bucketSeconds) {
      return this.db
        .select()
        .from(vpsMetricsHistory)
        .where(and(...conditions))
        .orderBy(vpsMetricsHistory.capturedAt);
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
   * single SQL aggregate pass - cheap regardless of how many raw rows exist
   * in that range (unlike fetching them all to compute this client-side).
   * Deliberately separate from the (possibly bucketed) /history endpoint
   * above so a coarse chart bucket size never affects these numbers.
   */
  @Get(":id/history/summary")
  async historySummary(
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const vpsId = parseIntParam(id, "id");
    const conditions = [eq(vpsMetricsHistory.vpsInventoryId, vpsId)];
    if (from) conditions.push(gte(vpsMetricsHistory.capturedAt, parseDateParam(from, "from")));
    if (to) conditions.push(lte(vpsMetricsHistory.capturedAt, parseDateParam(to, "to")));

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
