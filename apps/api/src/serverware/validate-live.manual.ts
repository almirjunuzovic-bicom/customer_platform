/**
 * Manual smoke test against a REAL ServerWare cluster (not an automated
 * test - needs a real source row in the DB, see add-source.manual.ts). Run
 * with: pnpm --filter @hosting-platform/api validate:serverware -- <sourceId>
 */
import "reflect-metadata";
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../db/schema";
import { SourcesService } from "../connectors/sources.service";
import { ServerwareService } from "./serverware.service";

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
  const svc = new ServerwareService();

  const hosts = await svc.listHosts(resolved);
  console.log(`hosts: ${hosts.length}`, hosts.slice(0, 2));

  const vpses = await svc.listVpses(resolved);
  console.log(`vpses: ${vpses.length}`, vpses.slice(0, 2));

  const partitions = await svc.listPartitions(resolved);
  console.log(`partitions: ${partitions.length}`, partitions);

  const leaksRootPassword = Object.keys(vpses[0] ?? {}).some((k) =>
    k.toLowerCase().includes("password"),
  );
  console.log("vps type leaks a password field:", leaksRootPassword);

  await pool.end();
}

main().catch((err) => {
  console.error("VALIDATION FAILED:", err);
  process.exit(1);
});
