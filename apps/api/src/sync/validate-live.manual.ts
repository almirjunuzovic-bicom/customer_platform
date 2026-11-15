/**
 * Manual smoke test against REAL ServerWare + REAL dev DB. Run with:
 * pnpm --filter @hosting-platform/api validate:sync -- <sourceId>
 */
import "reflect-metadata";
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../db/schema";
import { ConnectorRegistryService } from "../connectors/connector-registry.service";
import { SourcesService } from "../connectors/sources.service";
import { ServerwareService } from "../serverware/serverware.service";
import { SyncService } from "./sync.service";

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
  const connectorRegistry = new ConnectorRegistryService(new ServerwareService());
  const sync = new SyncService(db as never, connectorRegistry, sourcesService);

  console.log(`Syncing source id ${sourceId}...`);
  const result = await sync.syncSource(sourceId);
  console.log("Sync result:", result);

  const [sourceRows, inventoryRows, historyRows, eventRows] =
    await Promise.all([
      db.select().from(schema.sources),
      db.select().from(schema.vpsInventory).limit(3),
      db.select().from(schema.vpsMetricsHistory),
      db.select().from(schema.vpsEvents),
    ]);

  console.log("source rows:", sourceRows);
  console.log("sample vps_inventory rows:", inventoryRows);
  console.log("vps_metrics_history row count:", historyRows.length);
  console.log("vps_events rows:", eventRows);

  await pool.end();
}

main().catch((err) => {
  console.error("VALIDATION FAILED:", err);
  process.exit(1);
});
