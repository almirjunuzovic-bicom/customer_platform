/**
 * Worker process entry point - runs the SERVERware sync scheduler as a
 * standalone process (no HTTP server). Deployed as a separate process from
 * the eventual API server (see hst2171-architecture: one codebase, two
 * deployment processes).
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { Module } from "@nestjs/common";
import { RollupModule } from "./rollup/rollup.module";
import { SchedulingModule } from "./scheduling/scheduling.module";

@Module({ imports: [SchedulingModule, RollupModule] })
class WorkerModule {}

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ["log", "warn", "error"],
  });
  Logger.log("Worker started - scheduling SERVERware sync jobs", "Bootstrap");

  const shutdown = async () => {
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

bootstrap();
