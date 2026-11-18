import { HttpException, HttpStatus, Controller, Get, Inject, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { OpsService } from "./ops.service";

@Controller("ops")
@UseGuards(JwtAuthGuard)
export class OpsController {
  constructor(@Inject(OpsService) private readonly opsService: OpsService) {}

  @Get("worker-status")
  async workerStatus() {
    return this.opsService.workerStatus();
  }

  @Get("dev-status")
  async devStatus() {
    return this.opsService.devStatus();
  }

  @Post("start-worker")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  async startWorker() {
    try {
      await this.opsService.startWorker();
      return { status: "started", service: "hosting-platform-worker" };
    } catch (error) {
      throw new HttpException(
        `Failed to start worker: ${String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("stop-worker")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  async stopWorker() {
    try {
      await this.opsService.stopWorker();
      return { status: "stopped", service: "hosting-platform-worker" };
    } catch (error) {
      throw new HttpException(
        `Failed to stop worker: ${String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post("restart-worker")
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles("admin")
  async restartWorker() {
    try {
      await this.opsService.restartWorker();
      return { status: "restarted", service: "hosting-platform-worker" };
    } catch (error) {
      throw new HttpException(
        `Failed to restart worker: ${String(error)}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
