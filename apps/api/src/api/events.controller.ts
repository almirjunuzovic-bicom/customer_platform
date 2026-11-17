import { BadRequestException, Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DATABASE, type Database } from "../db/database.module";
import { vpsEvents, vpsInventory } from "../db/schema";

// Mirrors vpsEventTypeEnum in schema.ts - duplicated here rather than
// imported since mysqlEnum doesn't expose its value list as a plain
// array, and this set changes rarely enough that keeping both in sync by
// hand is fine.
const EVENT_TYPES = [
  "state_changed",
  "host_changed",
  "partition_changed",
  "resource_changed",
  "created",
  "removed",
  "action_requested",
] as const;

// Fleet-wide, unlike /vps/:id/events - every VPS's events in one query,
// so a cap is required (same reasoning as vps.controller.ts's
// MAX_RAW_HISTORY_ROWS: nothing upstream otherwise stops an unbounded
// fetch across ~400 production VPSes worth of history).
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

function parseDateParam(value: string, name: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`"${name}" must be a valid date`);
  }
  return date;
}

@Controller("events")
@UseGuards(JwtAuthGuard)
export class EventsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list(
    @Query("sourceId") sourceId?: string,
    @Query("eventType") eventType?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("limit") limit?: string,
  ) {
    if (eventType && !(EVENT_TYPES as readonly string[]).includes(eventType)) {
      throw new BadRequestException(
        `"eventType" must be one of: ${EVENT_TYPES.join(", ")}`,
      );
    }

    let limitNum = DEFAULT_LIMIT;
    if (limit) {
      limitNum = Number(limit);
      if (!Number.isInteger(limitNum) || limitNum <= 0) {
        throw new BadRequestException(`"limit" must be a positive integer`);
      }
      limitNum = Math.min(limitNum, MAX_LIMIT);
    }

    const conditions = [];
    if (sourceId) {
      const sourceIdNum = Number(sourceId);
      if (!Number.isInteger(sourceIdNum)) {
        throw new BadRequestException(`"sourceId" must be an integer`);
      }
      conditions.push(eq(vpsInventory.sourceId, sourceIdNum));
    }
    if (eventType) {
      conditions.push(eq(vpsEvents.eventType, eventType as (typeof EVENT_TYPES)[number]));
    }
    if (from) {
      conditions.push(gte(vpsEvents.detectedAt, parseDateParam(from, "from")));
    }
    if (to) {
      conditions.push(lte(vpsEvents.detectedAt, parseDateParam(to, "to")));
    }

    return this.db
      .select({
        id: vpsEvents.id,
        vpsInventoryId: vpsEvents.vpsInventoryId,
        vpsName: vpsInventory.name,
        sourceId: vpsInventory.sourceId,
        eventType: vpsEvents.eventType,
        previousValue: vpsEvents.previousValue,
        newValue: vpsEvents.newValue,
        detectedAt: vpsEvents.detectedAt,
        source: vpsEvents.source,
        actorUserId: vpsEvents.actorUserId,
      })
      .from(vpsEvents)
      .innerJoin(vpsInventory, eq(vpsEvents.vpsInventoryId, vpsInventory.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(vpsEvents.detectedAt))
      .limit(limitNum);
  }
}
