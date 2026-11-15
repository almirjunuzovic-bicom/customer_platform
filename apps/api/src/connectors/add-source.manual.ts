/**
 * Add (or update) a source directly against the DB - no running API needed.
 * Encrypts credentials with CREDENTIALS_ENCRYPTION_KEY before they touch
 * MySQL. Safe to re-run with the same --key to rotate config/credentials
 * (upsert, not insert-only).
 *
 * Usage:
 *   pnpm --filter @hosting-platform/api add:source \
 *     --key lon1 --name "UK Lon1" --connector-type serverware \
 *     --config '{"baseUrl":"https://uk-lon1.bicomsystems.com","netId":1}' \
 *     --credentials '{"apiToken":"srw_..."}'
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../db/schema";
import { CONNECTOR_TYPES, type ConnectorType } from "./connector.types";
import { SourcesService } from "./sources.service";

function parseArgs(argv: string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag?.startsWith("--")) {
      throw new Error(`Expected a --flag, got "${flag}"`);
    }
    args[flag.slice(2)] = argv[i + 1];
  }
  return args;
}

function parseJsonArg(raw: string | undefined, flagName: string): Record<string, unknown> {
  if (!raw) throw new Error(`Missing --${flagName}`);
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null) {
    throw new Error(`--${flagName} must be a JSON object`);
  }
  return parsed;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { key, name } = args;
  const connectorType = args["connector-type"];

  if (!key || !name || !connectorType) {
    console.error(
      "Usage: add-source --key <key> --name <name> --connector-type <serverware|aws|proxmox> --config <json> --credentials <json>",
    );
    process.exit(1);
  }
  if (!CONNECTOR_TYPES.includes(connectorType as ConnectorType)) {
    console.error(`--connector-type must be one of: ${CONNECTOR_TYPES.join(", ")}`);
    process.exit(1);
  }

  const config = parseJsonArg(args.config, "config");
  const credentials = parseJsonArg(args.credentials, "credentials");

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const db = drizzle(pool, { schema, mode: "default" });
  // SourcesService only needs @Inject(DATABASE) at runtime via Nest DI
  // normally - constructed directly here since this script runs outside
  // the Nest app context (same pattern as seed-user.manual.ts).
  const sourcesService = new SourcesService(db as never);

  const source = await sourcesService.upsert({
    key,
    name,
    connectorType: connectorType as ConnectorType,
    config,
    credentials,
  });
  console.log(`Source "${source.key}" (${source.connectorType}) saved, id=${source.id}, enabled=${source.enabled}`);
  console.log("Restart the worker service to pick it up: sources added/enabled/disabled only take effect on worker restart (scheduler is set up once at boot).");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
