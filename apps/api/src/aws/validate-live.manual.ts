/**
 * Manual smoke test against a REAL Lightsail account (not an automated test -
 * needs a real aws source row in the DB, see add-source.manual.ts). Run
 * with: pnpm --filter @hosting-platform/api validate:aws -- <sourceId>
 *
 * Deliberately bypasses AwsLightsailService and calls GetInstances directly -
 * unlike SourceVps, the raw Lightsail response's `tags` field isn't mapped
 * anywhere yet, and this script exists specifically to inspect it live
 * before deciding how (or whether) to map it.
 */
import "reflect-metadata";
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../db/schema";
import { SourcesService } from "../connectors/sources.service";
import { signLightsailRequest } from "./aws-sigv4";
import type { LightsailGetInstancesResponse } from "./aws.types";

async function main() {
  const sourceId = Number(process.argv[2] ?? 1);

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const db = drizzle(pool, { schema, mode: "default" });
  const sourcesService = new SourcesService(db as never);
  const resolved = await sourcesService.resolve(sourceId);

  const { regions } = resolved.config as { regions: string[] };
  const { accessKeyId, secretAccessKey } = resolved.credentials as {
    accessKeyId: string;
    secretAccessKey: string;
  };

  for (const region of regions) {
    const signed = signLightsailRequest(accessKeyId, secretAccessKey, region, "GetInstances", {});
    const response = await fetch(signed.url, {
      method: "POST",
      headers: signed.headers,
      body: signed.body,
    });
    const body = (await response.json()) as LightsailGetInstancesResponse;
    if (!response.ok) {
      console.error(`${region}: HTTP ${response.status}`, body);
      continue;
    }
    for (const instance of body.instances ?? []) {
      console.log(`${region}/${instance.name}:`, JSON.stringify(instance.tags ?? [], null, 2));
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error("VALIDATION FAILED:", err);
  process.exit(1);
});
