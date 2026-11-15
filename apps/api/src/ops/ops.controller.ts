import { execFile } from "node:child_process";
import { promisify } from "node:util";
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

const execFileAsync = promisify(execFile);

// Hardcoded on purpose, never taken from the request - this endpoint exists
// specifically so sources added/enabled/disabled (see SchedulingService -
// schedulers are only read at boot) don't need an SSH session to pick up.
// Accepting a service name from the client would turn "restart our own
// worker" into "run arbitrary sudo commands" - see hst2171-architecture.
// Runs as the `almir` system user, which already has passwordless sudo on
// this VM (pre-existing, not introduced for this feature) - execFile with
// an explicit argv (no shell) so there's no injection surface regardless.
const WORKER_SERVICE = "hosting-platform-worker";

@Controller("ops")
@UseGuards(JwtAuthGuard)
export class OpsController {
  @Get("worker-status")
  async workerStatus() {
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

  @Post("restart-worker")
  async restartWorker() {
    try {
      await execFileAsync("sudo", ["systemctl", "restart", WORKER_SERVICE]);
      return { status: "restarted", service: WORKER_SERVICE };
    } catch (error) {
      throw new HttpException(
        `Failed to restart ${WORKER_SERVICE}: ${String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
