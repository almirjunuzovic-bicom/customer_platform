import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { DatabaseModule } from "../db/database.module";
import { ServerwareModule } from "../serverware/serverware.module";
import { ConnectorRegistryService } from "./connector-registry.service";
import { SourcesController } from "./sources.controller";
import { SourcesService } from "./sources.service";

@Module({
  imports: [DatabaseModule, ServerwareModule, AuthModule],
  controllers: [SourcesController],
  providers: [SourcesService, ConnectorRegistryService],
  exports: [SourcesService, ConnectorRegistryService],
})
export class ConnectorsModule {}
