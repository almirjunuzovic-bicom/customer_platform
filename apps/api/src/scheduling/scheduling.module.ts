import { BullModule } from "@nestjs/bullmq";
import { Module } from "@nestjs/common";
import { SyncModule } from "../sync/sync.module";
import { SYNC_QUEUE } from "./scheduling.constants";
import { SchedulingService } from "./scheduling.service";
import { SyncProcessor } from "./sync.processor";

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST,
        port: Number(process.env.REDIS_PORT ?? 6379),
        password: process.env.REDIS_PASSWORD,
      },
    }),
    BullModule.registerQueue({ name: SYNC_QUEUE }),
    SyncModule,
  ],
  providers: [SchedulingService, SyncProcessor],
})
export class SchedulingModule {}
