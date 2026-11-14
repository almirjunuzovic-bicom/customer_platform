import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Queue } from "bullmq";
import { loadClusterConfigs } from "../serverware/serverware-cluster.config";
import { SYNC_INTERVAL_MS, SYNC_JOB_NAME, SYNC_QUEUE } from "./scheduling.constants";

@Injectable()
export class SchedulingService implements OnModuleInit {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(@InjectQueue(SYNC_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    const clusters = loadClusterConfigs();
    for (const { key } of clusters) {
      // upsertJobScheduler is idempotent on jobSchedulerId: re-registering
      // the same scheduler on every restart does not create duplicates.
      await this.queue.upsertJobScheduler(
        `sync-${key}`,
        { every: SYNC_INTERVAL_MS },
        { name: SYNC_JOB_NAME, data: { clusterKey: key } },
      );
      this.logger.log(
        `Scheduled "${key}" sync every ${SYNC_INTERVAL_MS}ms`,
      );
    }
  }
}
