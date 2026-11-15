import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Injectable, Logger } from "@nestjs/common";

const execFileAsync = promisify(execFile);

// Hardcoded on purpose, never taken from the request - this exists
// specifically so sources added/enabled/disabled/deleted (see
// SchedulingService - schedulers are only reconciled at worker boot) don't
// need an SSH session to pick up. Accepting a service name from the client
// would turn "restart our own worker" into "run arbitrary sudo commands" -
// see hst2171-architecture. Runs as the `almir` system user, which already
// has passwordless sudo on this VM (pre-existing, not introduced for this
// feature) - execFile with an explicit argv (no shell) so there's no
// injection surface regardless.
const WORKER_SERVICE = "hosting-platform-worker";

@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);

  async workerStatus(): Promise<{ service: string; active: boolean; state?: string }> {
    try {
      const { stdout } = await execFileAsync("systemctl", ["is-active", WORKER_SERVICE]);
      return { service: WORKER_SERVICE, active: stdout.trim() === "active" };
    } catch (error) {
      // `systemctl is-active` exits non-zero for inactive/failed units -
      // that's a normal result here, not a failure to report as 500.
      const stdout = (error as { stdout?: string }).stdout;
      return { service: WORKER_SERVICE, active: false, state: stdout?.trim() ?? "unknown" };
    }
  }

  async restartWorker(): Promise<void> {
    await execFileAsync("sudo", ["systemctl", "restart", WORKER_SERVICE]);
  }

  /**
   * Used right after a source create/enable-disable/delete so the worker's
   * BullMQ schedulers catch up immediately instead of waiting for someone
   * to click "Restart worker" - that button (and this same restart) stays
   * available for cases this doesn't cover (e.g. the worker itself crashed,
   * or a source was added via add-source.manual.ts outside the API).
   * Swallows failure on purpose: the source mutation that triggered this
   * already succeeded and is already committed, a failed restart just
   * means the old schedule lingers until someone retries manually - it
   * must never roll back or fail the request that asked for it.
   */
  async restartWorkerBestEffort(): Promise<void> {
    try {
      await this.restartWorker();
    } catch (error) {
      this.logger.warn(`Auto-restart of worker failed: ${String(error)}`);
    }
  }
}
