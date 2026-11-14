import { Controller, Get, Inject } from "@nestjs/common";
import { DATABASE, type Database } from "../db/database.module";
import { partitions } from "../db/schema";

@Controller("partitions")
export class PartitionsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list() {
    return this.db.select().from(partitions);
  }
}
