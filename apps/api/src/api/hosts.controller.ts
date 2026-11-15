import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { DATABASE, type Database } from "../db/database.module";
import { hosts } from "../db/schema";

@Controller("hosts")
@UseGuards(JwtAuthGuard)
export class HostsController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get()
  async list() {
    return this.db.select().from(hosts);
  }
}
