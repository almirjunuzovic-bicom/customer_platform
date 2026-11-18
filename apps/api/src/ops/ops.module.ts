import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../db/database.module";
import { OpsController } from "./ops.controller";
import { OpsService } from "./ops.service";

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [OpsController],
  providers: [OpsService],
  exports: [OpsService],
})
export class OpsModule {}
