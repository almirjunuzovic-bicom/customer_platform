import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Logger } from "@nestjs/common";
import type { Job } from "bullmq";
import { SyncService } from "../sync/sync.service";
import type { SyncResult } from "../sync/sync.types";
import { SYNC_QUEUE } from "./scheduling.constants";

interface SyncJobData {
  sourceId: number;
}

@Processor(SYNC_QUEUE)
export class SyncProcessor extends WorkerHost {
  private readonly logger = new Logger(SyncProcessor.name);

  constructor(@Inject(SyncService) private readonly syncService: SyncService) {
    super();
  }

  async process(job: Job<SyncJobData>): Promise<SyncResult> {
    const result = await this.syncService.syncSource(job.data.sourceId);
    if (result.ok) {
      // One line per tick so `journalctl -f` shows live activity, not just
      // silence punctuated by failures. Negligible cost either way (see
      // feedback_latest_versions-style benchmark in hst2171-architecture:
      // ~3us CPU/call, journald already capped at 100M on the VM).
      this.logger.log(
        `"${result.sourceKey}" synced: ${result.hostsCount} hosts, ${result.vpsesCount} vpses, ${result.partitionsCount} partitions`,
      );
    } else {
      // Logged, not thrown: a down/misconfigured source is expected/handled
      // behavior (see SourceUnavailableError), not a job failure to retry
      // aggressively - the next repeatable tick will try again anyway.
      this.logger.warn(`Source "${result.sourceKey}" sync failed: ${result.error}`);
    }
    return result;
  }
}
