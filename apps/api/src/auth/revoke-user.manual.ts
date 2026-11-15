/**
 * Immediately revoke every outstanding token for a user (e.g. a leaked
 * token, someone leaving the team) without changing their password.
 * Usage: pnpm --filter @hosting-platform/api revoke:user <email>
 */
import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../db/schema";

async function main() {
  const [email] = process.argv.slice(2);
  if (!email) {
    console.error("Usage: revoke-user <email>");
    process.exit(1);
  }

  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  });
  const db = drizzle(pool, { schema, mode: "default" });

  const result = await db
    .update(schema.users)
    .set({ tokenVersion: sql`${schema.users.tokenVersion} + 1` })
    .where(eq(schema.users.email, email));

  if (result[0].affectedRows === 0) {
    console.error(`No user with email ${email}`);
    process.exit(1);
  }
  console.log(`Revoked all tokens for ${email}`);
  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
