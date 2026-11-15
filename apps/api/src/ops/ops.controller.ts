import { HttpException, HttpStatus, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { OpsService } from "./ops.service";

@Controller("ops")
@UseGuards(JwtAuthGuard)
export class OpsController {
  constructor(private readonly opsService: OpsService) {}

  @Get("worker-status")
  async workerStatus() {
    return this.opsService.workerStatus();
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
