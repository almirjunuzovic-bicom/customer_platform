import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { decryptJson, encryptJson } from "../common/crypto";
import { DATABASE, type Database } from "../db/database.module";
import { sources } from "../db/schema";
import { SourceUnavailableError, type ConnectorType, type ResolvedSource } from "./connector.types";

export interface CreateSourceInput {
  key: string;
  name: string;
  connectorType: ConnectorType;
  /** Non-secret, connector-specific settings (serverware: {baseUrl, netId}). */
  config: Record<string, unknown>;
  /** Secret half (serverware: {apiToken}) - encrypted before it ever touches the DB. */
  credentials: Record<string, unknown>;
}

/** Never includes credentials - see resolve() for the one place those get decrypted. */
export interface SourceSummary {
  id: number;
  key: string;
  name: string;
  connectorType: string;
  enabled: boolean;
  config: Record<string, unknown> | null;
  lastSyncAt: Date | null;
  lastSyncOk: boolean | null;
  lastSyncError: string | null;
  createdAt: Date;
}

@Injectable()
export class SourcesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(): Promise<SourceSummary[]> {
    const rows = await this.db.select().from(sources);
    return rows.map(toSummary);
  }

  /** Raw rows (id/key/connectorType only needed) for the scheduler - no credentials involved. */
  async listEnabled(): Promise<{ id: number; key: string; connectorType: string }[]> {
    return this.db
      .select({ id: sources.id, key: sources.key, connectorType: sources.connectorType })
      .from(sources)
      .where(eq(sources.enabled, true));
  }

  /**
   * Insert-or-update by key - lets `add-source.manual.ts` be re-run safely
   * (e.g. to rotate a token) without a separate "update" codepath.
   */
  async upsert(input: CreateSourceInput): Promise<SourceSummary> {
    const credentialsEncrypted = encryptJson(input.credentials);
    await this.db
      .insert(sources)
      .values({
        key: input.key,
        name: input.name,
        connectorType: input.connectorType,
        config: input.config,
        credentialsEncrypted,
      })
      .onDuplicateKeyUpdate({
        set: {
          name: input.name,
          connectorType: input.connectorType,
          config: input.config,
          credentialsEncrypted,
        },
      });
    return this.getByKeyOrThrow(input.key);
  }

  async setEnabled(id: number, enabled: boolean): Promise<SourceSummary> {
    await this.db.update(sources).set({ enabled }).where(eq(sources.id, id));
    return this.getByIdOrThrow(id);
  }

  /**
   * Decrypts credentials - internal use only (connectors + sync), never
   * exposed over the API. The ONE chokepoint every caller that talks to a
   * real source goes through (SyncService AND VpsController's start/stop/
   * restart) - so the `enabled` check belongs here, not duplicated in each
   * caller. Confirmed live this was missing: disabling lon1 still let a
   * VPS start action fire for real against SERVERware, because
   * VpsController had no enabled check of its own and relied on nothing.
   */
  async resolve(id: number): Promise<ResolvedSource> {
    const [row] = await this.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!row) throw new NotFoundException(`No source with id ${id}`);
    if (!row.enabled) {
      throw new SourceUnavailableError(row.key, "source is disabled");
    }
    if (!row.config || !row.credentialsEncrypted) {
      throw new SourceUnavailableError(row.key, "source has no config/credentials set yet");
    }
    return {
      id: row.id,
      key: row.key,
      connectorType: row.connectorType as ConnectorType,
      config: row.config as Record<string, unknown>,
      credentials: decryptJson(row.credentialsEncrypted),
    };
  }

  private async getByKeyOrThrow(key: string): Promise<SourceSummary> {
    const [row] = await this.db.select().from(sources).where(eq(sources.key, key)).limit(1);
    if (!row) throw new NotFoundException(`No source with key "${key}"`);
    return toSummary(row);
  }

  private async getByIdOrThrow(id: number): Promise<SourceSummary> {
    const [row] = await this.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    if (!row) throw new NotFoundException(`No source with id ${id}`);
    return toSummary(row);
  }
}

function toSummary(row: typeof sources.$inferSelect): SourceSummary {
  return {
    id: row.id,
    key: row.key,
    name: row.name,
    connectorType: row.connectorType,
    enabled: row.enabled,
    config: row.config as Record<string, unknown> | null,
    lastSyncAt: row.lastSyncAt,
    lastSyncOk: row.lastSyncOk,
    lastSyncError: row.lastSyncError,
    createdAt: row.createdAt,
  };
}
