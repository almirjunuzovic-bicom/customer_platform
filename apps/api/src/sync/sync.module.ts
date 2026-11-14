import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/database.module";
import { ServerwareModule } from "../serverware/serverware.module";
import { SyncService } from "./sync.service";

@Module({
  imports: [DatabaseModule, ServerwareModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
