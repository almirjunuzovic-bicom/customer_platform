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
    const enabledSchedulerIds = new Set(enabledSources.map((s) => `sync-${s.key}`));

    // upsertJobScheduler only ever ADDS/updates - a scheduler registered on
    // a previous boot keeps firing in Redis forever otherwise, even after
    // its source is disabled or deleted (confirmed live: disabling a source
    // + restarting the worker did NOT stop its sync, this is why). Remove
    // anything stale before (re-)registering what should actually run now.
    const existingSchedulers = await this.queue.getJobSchedulers();
    for (const scheduler of existingSchedulers) {
      // `.key` is the jobSchedulerId (what upsertJobScheduler/
      // removeJobScheduler take) - `.id` is a separate, unrelated optional
      // field (almost always undefined here), NOT the scheduler's identity.
      if (!enabledSchedulerIds.has(scheduler.key)) {
        await this.queue.removeJobScheduler(scheduler.key);
        this.logger.log(`Removed stale scheduler "${scheduler.key}" (source disabled/removed)`);
      }
    }

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
