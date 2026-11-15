import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { ConnectorsModule } from "../connectors/connectors.module";
import { DatabaseModule } from "../db/database.module";
import { PartitionsController } from "./partitions.controller";
import { VpsController } from "./vps.controller";

@Module({
  imports: [DatabaseModule, AuthModule, ConnectorsModule],
  controllers: [PartitionsController, VpsController],
})
export class ApiModule {}
