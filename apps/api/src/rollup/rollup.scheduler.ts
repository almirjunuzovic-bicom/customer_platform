import { InjectQueue } from "@nestjs/bullmq";
import { Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Queue } from "bullmq";
import { ROLLUP_INTERVAL_MS, ROLLUP_JOB_NAME, ROLLUP_QUEUE, ROLLUP_SCHEDULER_ID } from "./rollup.constants";

/** A single fixed repeatable job, unlike SchedulingService's per-source ones - rollup isn't per-source. */
@Injectable()
export class RollupScheduler implements OnModuleInit {
  private readonly logger = new Logger(RollupScheduler.name);

  constructor(@InjectQueue(ROLLUP_QUEUE) private readonly queue: Queue) {}

  async onModuleInit(): Promise<void> {
    await this.queue.upsertJobScheduler(
      ROLLUP_SCHEDULER_ID,
      { every: ROLLUP_INTERVAL_MS },
      { name: ROLLUP_JOB_NAME },
    );
    this.logger.log(`Scheduled metrics rollup every ${ROLLUP_INTERVAL_MS}ms`);
  }
}
