import { Module } from "@nestjs/common";
import { ServerwareService } from "./serverware.service";

@Module({
  providers: [ServerwareService],
  exports: [ServerwareService],
})
export class ServerwareModule {}
