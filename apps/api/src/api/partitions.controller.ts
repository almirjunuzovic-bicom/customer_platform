import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DATABASE, type Database } from "../db/database.module";
import { partitions } from "../db/schema";

@Controller("partitions")
@UseGuards(JwtAuthGuard)
export class PartitionsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list() {
    return this.db.select().from(partitions);
  }
}
