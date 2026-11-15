import { Module } from "@nestjs/common";
import { ConnectorsModule } from "../connectors/connectors.module";
import { DatabaseModule } from "../db/database.module";
import { SyncService } from "./sync.service";

@Module({
  imports: [DatabaseModule, ConnectorsModule],
  providers: [SyncService],
  exports: [SyncService],
})
export class SyncModule {}
