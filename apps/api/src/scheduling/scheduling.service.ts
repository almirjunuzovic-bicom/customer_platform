import { InjectQueue } from "@nestjs/bullmq";
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { Queue } from "bullmq";
import { SourcesService } from "../connectors/sources.service";
import { SYNC_INTERVAL_MS, SYNC_JOB_NAME, SYNC_QUEUE } from "./scheduling.constants";

@Injectable()
export class SchedulingService implements OnModuleInit {
  private readonly logger = new Logger(SchedulingService.name);

  constructor(
    @InjectQueue(SYNC_QUEUE) private readonly queue: Queue,
    @Inject(SourcesService) private readonly sourcesService: SourcesService,
  ) {}

  // Schedulers are only (re-)read here, at boot - adding/enabling/disabling
  // a source via SourcesController or add-source.manual.ts takes effect on
  // the next worker restart, not live. See hst2171-architecture.
  async onModuleInit(): Promise<void> {
    const enabledSources = await this.sourcesService.listEnabled();
    for (const source of enabledSources) {
      // upsertJobScheduler is idempotent on jobSchedulerId: re-registering
      // the same scheduler on every restart does not create duplicates.
      await this.queue.upsertJobScheduler(
        `sync-${source.key}`,
        { every: SYNC_INTERVAL_MS },
        { name: SYNC_JOB_NAME, data: { sourceId: source.id } },
      );
      this.logger.log(
        `Scheduled "${source.key}" (${source.connectorType}) sync every ${SYNC_INTERVAL_MS}ms`,
      );
    }
  }
}
