import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { ROLLUP_QUEUE } from "./rollup.constants";
import { RollupService } from "./rollup.service";

@Processor(ROLLUP_QUEUE)
export class RollupProcessor extends WorkerHost {
  private readonly logger = new Logger(RollupProcessor.name);

  constructor(@Inject(RollupService) private readonly rollupService: RollupService) {
    super();
  }

  async process(_job: Job): Promise<void> {
    try {
      await this.rollupService.run();
    } catch (error) {
      // Logged, not rethrown as a hard failure - a missed rollup tick just
      // means more raw/fine-tier data than usual sits around until the
      // next successful run, not data loss or a stuck state.
      this.logger.warn(`Rollup run failed: ${String(error)}`);
    }
  }
}
