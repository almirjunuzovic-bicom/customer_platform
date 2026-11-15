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
import { and, eq, gte, isNull, lt, lte, or } from "drizzle-orm";
import { CurrentUser } from "../auth/current-user.decorator";
import type { AuthenticatedUser } from "../auth/auth.types";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DATABASE, type Database } from "../db/database.module";
import { clusters, vpsEvents, vpsInventory, vpsMetricsHistory } from "../db/schema";
import { ServerwareService } from "../serverware/serverware.service";
import { ServerwareUnavailableError } from "../serverware/serverware.errors";

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

@Controller("vps")
@UseGuards(JwtAuthGuard)
export class VpsController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ServerwareService) private readonly serverware: ServerwareService,
  ) {}

  @Get()
  async list(
    @Query("clusterId") clusterId?: string,
    @Query("partitionId") partitionId?: string,
    @Query("includeRemoved") includeRemoved?: string,
  ) {
    const conditions = [];
    if (clusterId) {
      conditions.push(eq(vpsInventory.clusterId, parseIntParam(clusterId, "clusterId")));
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

  @Get(":id/history")
  async history(
    @Param("id") id: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    const vpsId = parseIntParam(id, "id");
    const conditions = [eq(vpsMetricsHistory.vpsInventoryId, vpsId)];

    if (from) {
      const fromDate = new Date(from);
      if (Number.isNaN(fromDate.getTime())) {
        throw new BadRequestException(`"from" is not a valid date`);
      }
      conditions.push(gte(vpsMetricsHistory.capturedAt, fromDate));
    }
    if (to) {
      const toDate = new Date(to);
      if (Number.isNaN(toDate.getTime())) {
        throw new BadRequestException(`"to" is not a valid date`);
      }
      conditions.push(lte(vpsMetricsHistory.capturedAt, toDate));
    }

    return this.db
      .select()
      .from(vpsMetricsHistory)
      .where(and(...conditions))
      .orderBy(vpsMetricsHistory.capturedAt);
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
   * Fires the action and returns immediately once SERVERware has accepted
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

    const [cluster] = await this.db
      .select({ key: clusters.key })
      .from(clusters)
      .where(eq(clusters.id, vps.clusterId))
      .limit(1);
    if (!cluster) {
      throw new NotFoundException(`No cluster for VPS ${vpsId}`);
    }

    // SERVERware's own guard: it 400s start/stop/restart while some OTHER
    // task is in progress (confirmed live - see hst2171-serverware-api).
    // Check it ourselves first so we don't even make the call.
    if (vps.task) {
      throw new ConflictException(
        `SERVERware operation already in progress on this VPS: ${vps.task}`,
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
      const typedAction = action as VpsAction;
      if (typedAction === "start") {
        await this.serverware.startVps(cluster.key, vps.serverwareVpsId);
      } else if (typedAction === "stop") {
        await this.serverware.stopVps(cluster.key, vps.serverwareVpsId);
      } else {
        await this.serverware.restartVps(cluster.key, vps.serverwareVpsId);
      }
    } catch (error) {
      // The call never actually landed on SERVERware's side - release our
      // lock immediately instead of blocking retries for the full timeout.
      await this.db
        .update(vpsInventory)
        .set({ pendingAction: null, pendingActionAt: null })
        .where(eq(vpsInventory.id, vpsId));
      if (error instanceof ServerwareUnavailableError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }

    return { status: "requested", action, vpsId };
  }
}
