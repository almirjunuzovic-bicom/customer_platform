import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { Inject, Injectable, Logger } from "@nestjs/common";
import { sql } from "drizzle-orm";
import Redis from "ioredis";
import { DATABASE, type Database } from "../db/database.module";

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

// Matches the local dev script's argv (`tsx watch src/worker.ts`). Only
// ever consulted when unitLoadState() says the systemd unit isn't loaded
// (see below) - on a real systemd-managed box this branch is never taken,
// so there's no chance of this pattern colliding with anything there.
const WORKER_PROCESS_PATTERN = "src/worker.ts";

export interface WorkerStatus {
  managed: "systemd" | "process";
  active: boolean;
  state?: string;
  pid?: number;
}

export interface HealthCheck {
  ok: boolean;
  error?: string;
}

export interface DevStatus {
  worker: WorkerStatus;
  db: HealthCheck;
  redis: HealthCheck;
}

// Only meaningful on the shared staging VM, where this unit (and
// passwordless sudo for it) actually exists - see ONBOARDING.md. On a
// local dev laptop, the worker is just a plain `pnpm worker:dev` process,
// no systemd unit at all - distinguishing the two lets this service
// actually manage the worker either way instead of only working on
// staging and telling local dev to do it by hand.
@Injectable()
export class OpsService {
  private readonly logger = new Logger(OpsService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async unitLoadState(): Promise<string> {
    try {
      const { stdout } = await execFileAsync("systemctl", [
        "show",
        "-p",
        "LoadState",
        "--value",
        WORKER_SERVICE,
      ]);
      return stdout.trim();
    } catch {
      return "unknown";
    }
  }

  /** pgrep exits 1 with empty stdout when nothing matches - not a real error. */
  private async findWorkerPids(): Promise<number[]> {
    try {
      const { stdout } = await execFileAsync("pgrep", ["-f", WORKER_PROCESS_PATTERN]);
      return stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(Number);
    } catch {
      return [];
    }
  }

  async workerStatus(): Promise<WorkerStatus> {
    if ((await this.unitLoadState()) === "loaded") {
      try {
        const { stdout } = await execFileAsync("systemctl", ["is-active", WORKER_SERVICE]);
        return { managed: "systemd", active: stdout.trim() === "active" };
      } catch (error) {
        // `systemctl is-active` exits non-zero for inactive/failed units -
        // that's a normal result here, not a failure to report as 500.
        const stdout = (error as { stdout?: string }).stdout;
        return { managed: "systemd", active: false, state: stdout?.trim() ?? "unknown" };
      }
    }
    const pids = await this.findWorkerPids();
    return { managed: "process", active: pids.length > 0, pid: pids[0] };
  }

  async startWorker(): Promise<void> {
    if ((await this.unitLoadState()) === "loaded") {
      await execFileAsync("sudo", ["systemctl", "start", WORKER_SERVICE]);
      return;
    }
    if ((await this.findWorkerPids()).length > 0) return; // already running
    // detached + unref so this survives the API process's own tsx-watch
    // restarts - cwd is apps/api in both dev (`tsx watch src/api.ts`) and
    // prod (systemd WorkingDirectory), so process.cwd() is reliable here.
    const child = spawn("pnpm", ["run", "worker:dev"], {
      cwd: process.cwd(),
      detached: true,
      stdio: "ignore",
    });
    child.unref();
  }

  async stopWorker(): Promise<void> {
    if ((await this.unitLoadState()) === "loaded") {
      await execFileAsync("sudo", ["systemctl", "stop", WORKER_SERVICE]);
      return;
    }
    const pids = await this.findWorkerPids();
    for (const pid of pids) {
      try {
        process.kill(pid, "SIGTERM");
      } catch {
        // already gone
      }
    }
    for (let i = 0; i < 10 && (await this.findWorkerPids()).length > 0; i++) {
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
    for (const pid of await this.findWorkerPids()) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        // already gone
      }
    }
  }

  async restartWorker(): Promise<void> {
    if ((await this.unitLoadState()) === "loaded") {
      await execFileAsync("sudo", ["systemctl", "restart", WORKER_SERVICE]);
      return;
    }
    await this.stopWorker();
    await this.startWorker();
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

  private async checkDb(): Promise<HealthCheck> {
    try {
      await this.db.execute(sql`SELECT 1`);
      return { ok: true };
    } catch (error) {
      return { ok: false, error: String(error) };
    }
  }

  private async checkRedis(): Promise<HealthCheck> {
    const client = new Redis({
      host: process.env.REDIS_HOST,
      port: Number(process.env.REDIS_PORT ?? 6379),
      password: process.env.REDIS_PASSWORD,
      lazyConnect: true,
      retryStrategy: () => null,
      maxRetriesPerRequest: 1,
    });
    try {
      await client.connect();
      const pong = await client.ping();
      return { ok: pong === "PONG" };
    } catch (error) {
      return { ok: false, error: String(error) };
    } finally {
      client.disconnect();
    }
  }

  /** Aggregate view for the (temporary) Dev status page - see hst2171-architecture. */
  async devStatus(): Promise<DevStatus> {
    const [worker, db, redis] = await Promise.all([
      this.workerStatus(),
      this.checkDb(),
      this.checkRedis(),
    ]);
    return { worker, db, redis };
  }
}
