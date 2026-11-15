import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DATABASE, type Database } from "../db/database.module";
import { clusters } from "../db/schema";

@Controller("clusters")
@UseGuards(JwtAuthGuard)
export class ClustersController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list() {
    return this.db.select().from(clusters);
  }
}
