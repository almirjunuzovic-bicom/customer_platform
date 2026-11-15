import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../db/database.module";
import { ClustersController } from "./clusters.controller";
import { PartitionsController } from "./partitions.controller";
import { VpsController } from "./vps.controller";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [ClustersController, PartitionsController, VpsController],
})
export class ApiModule {}
