/**
 * API process entry point - read-only HTTP endpoints over the data the
 * worker collects. Bound to the PRIVATE IP only, not the public one - no
 * auth exists yet (see hst2171-architecture open question #1), so this must
 * not be reachable from the internet. Same codebase, separate deployment
 * process from worker.ts (see hst2171-architecture: "2 deployment processes").
 */
import "reflect-metadata";
import "dotenv/config";
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { ApiModule } from "./api/api.module";

async function bootstrap() {
  const app = await NestFactory.create(ApiModule);
  app.enableCors(); // dev convenience only - this sits behind a private IP, not the public internet

  const host = process.env.API_HOST ?? "127.0.0.1";
  const port = Number(process.env.API_PORT ?? 3001);
  await app.listen(port, host);
  Logger.log(`API listening on ${host}:${port}`, "Bootstrap");
}

bootstrap();
