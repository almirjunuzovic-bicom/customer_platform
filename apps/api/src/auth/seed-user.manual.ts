/**
 * Create/update an internal user. No public registration endpoint exists on
 * purpose (internal staff only) - this is the only way to provision one.
 * Usage: pnpm --filter @hosting-platform/api seed:user <email> <name> <password>
 */
import "dotenv/config";
import { hash } from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "../db/schema";

const SALT_ROUNDS = 12;

async function main() {
  const [email, name, password] = process.argv.slice(2);
  if (!email || !name || !password) {
    console.error("Usage: seed-user <email> <name> <password>");
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

  const passwordHash = await hash(password, SALT_ROUNDS);

  await db
    .insert(schema.users)
    .values({ email, name, passwordHash })
    .onDuplicateKeyUpdate({
      // Resetting a password also revokes any tokens issued under the old
      // one - otherwise someone who leaked the old password keeps a live
      // session through the reset.
      set: { name, passwordHash, tokenVersion: sql`${schema.users.tokenVersion} + 1` },
    });

  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, email))
    .limit(1);

  console.log("User ready:", user);
  await pool.end();
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
