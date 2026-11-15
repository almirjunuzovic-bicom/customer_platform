import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { DatabaseModule } from "../db/database.module";
import { ROLLUP_QUEUE } from "./rollup.constants";
import { RollupProcessor } from "./rollup.processor";
import { RollupScheduler } from "./rollup.scheduler";
import { RollupService } from "./rollup.service";

@Module({
  imports: [DatabaseModule, BullModule.registerQueue({ name: ROLLUP_QUEUE })],
  providers: [RollupService, RollupProcessor, RollupScheduler],
})
export class RollupModule {}
