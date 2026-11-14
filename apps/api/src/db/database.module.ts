import { Module } from "@nestjs/common";
import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import * as schema from "./schema";

export const DATABASE = Symbol("DATABASE");
export type Database = MySql2Database<typeof schema>;

@Module({
  providers: [
    {
      provide: DATABASE,
      useFactory: (): Database => {
        const pool = mysql.createPool({
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT ?? 3306),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
          connectionLimit: 10,
        });
        return drizzle(pool, { schema, mode: "default" });
      },
    },
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
