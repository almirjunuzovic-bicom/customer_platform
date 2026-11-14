import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { SyncService } from "../sync/sync.service";
import type { SyncResult } from "../sync/sync.types";
import { SYNC_QUEUE } from "./scheduling.constants";

interface SyncJobData {
  clusterKey: string;
}

@Processor(SYNC_QUEUE)
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(@Inject(SyncService) private readonly syncService: SyncService) {
    super();
  }

  async process(job: Job<SyncJobData>): Promise<SyncResult> {
    const result = await this.syncService.syncCluster(job.data.clusterKey);
    if (!result.ok) {
      // Logged, not thrown: a down cluster is expected/handled behavior
      // (see ServerwareUnavailableError), not a job failure to retry
      // aggressively - the next repeatable tick will try again anyway.
      this.logger.warn(`Cluster "${job.data.clusterKey}" sync failed: ${result.error}`);
    }
    return result;
  }
}
