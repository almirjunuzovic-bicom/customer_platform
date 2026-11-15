import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { OpsController } from "./ops.controller";

@Module({
  imports: [AuthModule],
  controllers: [OpsController],
})
export class OpsModule {}
