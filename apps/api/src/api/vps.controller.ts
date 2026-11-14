import {
  BadRequestException,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Query,
} from "@nestjs/common";
import { and, eq, gte, lte } from "drizzle-orm";
import { DATABASE, type Database } from "../db/database.module";
import { vpsEvents, vpsInventory, vpsMetricsHistory } from "../db/schema";

function parseIntParam(value: string, name: string): number {
  const n = Number(value);
  if (!Number.isInteger(n)) {
    throw new BadRequestException(`"${name}" must be an integer`);
  }
  return n;
}

@Controller("vps")
export class VpsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

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
}
