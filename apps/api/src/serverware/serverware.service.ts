import { Injectable, Logger } from "@nestjs/common";
import { withRetry } from "../common/retry";
import {
  loadClusterConfigs,
  type ServerwareClusterConfig,
} from "./serverware-cluster.config";
import {
  ServerwareUnavailableError,
  ServerwareUnknownClusterError,
} from "./serverware.errors";
import {
  mapHost,
  mapPartition,
  mapVps,
  type ServerwareEnvelope,
  type ServerwareHost,
  type ServerwareHostRaw,
  type ServerwarePartition,
  type ServerwarePartitionRaw,
  type ServerwareVps,
  type ServerwareVpsRaw,
} from "./serverware.types";

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Pure API client for ServerWare's sw-wcp surface. Knows nothing about our
 * MySQL schema - the (future) SyncModule owns persistence. See
 * hst2171-architecture: ServerwareModule/SyncModule split.
 */
@Injectable()
export class ServerwareService {
  private readonly logger = new Logger(ServerwareService.name);
  private readonly clusters: Map<string, ServerwareClusterConfig>;

  // No constructor parameter on purpose: NestJS's DI tries to inject every
  // constructor parameter it finds, default value or not. A TS array type
  // erases to the bare `Array` constructor in reflected metadata, which
  // Nest then tries (and fails) to resolve as a provider token. Tests that
  // need custom cluster configs should construct the Map directly instead
  // of going through `new ServerwareService(...)`.
  constructor() {
    this.clusters = new Map(loadClusterConfigs().map((c) => [c.key, c]));
  }

  listClusterKeys(): string[] {
    return [...this.clusters.keys()];
  }

  async listHosts(clusterKey: string): Promise<ServerwareHost[]> {
    const cluster = this.getCluster(clusterKey);
    const raw = await this.request<ServerwareHostRaw[]>(
      cluster,
      `/api/networks/${cluster.netId}/hosts`,
    );
    return raw.map(mapHost);
  }

  async listVpses(clusterKey: string): Promise<ServerwareVps[]> {
    const cluster = this.getCluster(clusterKey);
    const raw = await this.request<ServerwareVpsRaw[]>(
      cluster,
      `/api/networks/${cluster.netId}/vpses`,
    );
    return raw.map(mapVps);
  }

  async listPartitions(clusterKey: string): Promise<ServerwarePartition[]> {
    const cluster = this.getCluster(clusterKey);
    const raw = await this.request<ServerwarePartitionRaw[]>(
      cluster,
      `/api/networks/${cluster.netId}/partitions`,
    );
    return raw.map(mapPartition);
  }

  /**
   * Write actions - gated by project policy, explicit sign-off obtained
   * (see hst2171-architecture). Deliberately NOT wrapped in retry (see
   * performAction) - a retried restart after an ambiguous timeout could
   * double-fire against real infrastructure.
   */
  async startVps(clusterKey: string, serverwareVpsId: number): Promise<void> {
    await this.performAction(clusterKey, serverwareVpsId, "start");
  }

  async stopVps(clusterKey: string, serverwareVpsId: number): Promise<void> {
    await this.performAction(clusterKey, serverwareVpsId, "stop");
  }

  async restartVps(clusterKey: string, serverwareVpsId: number): Promise<void> {
    await this.performAction(clusterKey, serverwareVpsId, "restart");
  }

  private async performAction(
    clusterKey: string,
    serverwareVpsId: number,
    action: "start" | "stop" | "restart",
  ): Promise<void> {
    const cluster = this.getCluster(clusterKey);
    const path = `/api/networks/${cluster.netId}/vpses/${serverwareVpsId}/${action}`;
    try {
      // No automatic retry here - per "Never assume a VPS's state changed
      // just because this platform sent an API call" (SERVERWARE_API.md
      // §0), the caller must re-read state afterward anyway, so we don't
      // compound that with blind retries on an action whose first attempt
      // may or may not have actually landed.
      await this.doFetch<unknown>(cluster, path, "POST");
    } catch (error) {
      throw new ServerwareUnavailableError(cluster.key, error);
    }
  }

  private getCluster(clusterKey: string): ServerwareClusterConfig {
    const cluster = this.clusters.get(clusterKey);
    if (!cluster) throw new ServerwareUnknownClusterError(clusterKey);
    return cluster;
  }

  private async request<T>(
    cluster: ServerwareClusterConfig,
    path: string,
  ): Promise<T> {
    try {
      return await withRetry(
        () => this.doFetch<T>(cluster, path),
        {
          retries: 3,
          onRetry: (error, attempt) =>
            this.logger.warn(
              `Retry ${attempt} for ${cluster.key}${path}: ${String(error)}`,
            ),
        },
      );
    } catch (error) {
      // Never let a raw network/parse error reach the caller - always a
      // typed "unavailable", per hst2171-serverware-api: "Failed API call ->
      // Unknown/stale, never silently Stopped".
      throw new ServerwareUnavailableError(cluster.key, error);
    }
  }

  private async doFetch<T>(
    cluster: ServerwareClusterConfig,
    path: string,
    method: "GET" | "POST" = "GET",
  ): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${cluster.baseUrl}${path}`, {
        method,
        headers: { "SW-API-Token": cluster.apiToken },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} from ${cluster.key}${path}`,
        );
      }

      const body = (await response.json()) as ServerwareEnvelope<T>;
      if (body.status !== "success") {
        throw new Error(`Unexpected status "${body.status}" from ${path}`);
      }
      return body.data;
    } finally {
      clearTimeout(timeout);
    }
  }
}
