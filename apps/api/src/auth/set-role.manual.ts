/**
 * Set a user's role - the only way to grant/revoke admin, same pattern as
 * seed-user.manual.ts (no admin UI for this on purpose: who's an admin is
 * explicit, out-of-band, never self-service).
 * Usage: pnpm --filter @hosting-platform/api set:role <email> <admin|staff>
 */
import "dotenv/config";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../db/schema";

async function main() {
  const [email, role] = process.argv.slice(2);
  if (!email || (role !== "admin" && role !== "staff")) {
    console.error("Usage: set-role <email> <admin|staff>");
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

  const result = await db.update(schema.users).set({ role }).where(eq(schema.users.email, email));
  if (result[0].affectedRows === 0) {
    console.error(`No user with email "${email}"`);
    process.exit(1);
  }

  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email, role: schema.users.role })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);
  console.log("Role updated:", user);
  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
