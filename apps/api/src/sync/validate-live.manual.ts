/**
 * Manual smoke test against REAL ServerWare + REAL dev DB. Run with:
 * pnpm --filter @hosting-platform/api validate:sync
 */
import "reflect-metadata";
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../db/schema";
import { ServerwareService } from "../serverware/serverware.service";
import { SyncService } from "./sync.service";

async function main() {
  const clusterKey = process.argv[2] ?? "lon1";

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const db = drizzle(pool, { schema, mode: "default" });
  const serverware = new ServerwareService();
  const sync = new SyncService(db, serverware);

  console.log(`Syncing cluster "${clusterKey}"...`);
  const result = await sync.syncCluster(clusterKey);
  console.log("Sync result:", result);

  const [clusterRows, inventoryRows, historyRows, eventRows] =
    await Promise.all([
      db.select().from(schema.clusters),
      db.select().from(schema.vpsInventory).limit(3),
      db.select().from(schema.vpsMetricsHistory),
      db.select().from(schema.vpsEvents),
    ]);

  console.log("cluster rows:", clusterRows);
  console.log("sample vps_inventory rows:", inventoryRows);
  console.log("vps_metrics_history row count:", historyRows.length);
  console.log("vps_events rows:", eventRows);

  await pool.end();
}

main().catch((err) => {
  console.error("VALIDATION FAILED:", err);
  process.exit(1);
});
