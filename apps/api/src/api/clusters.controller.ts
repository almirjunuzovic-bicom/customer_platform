import { Controller, Get, Inject } from "@nestjs/common";
import { DATABASE, type Database } from "../db/database.module";
import { clusters } from "../db/schema";

@Controller("clusters")
export class ClustersController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list() {
    return this.db.select().from(clusters);
  }
}
