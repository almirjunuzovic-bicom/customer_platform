import { Injectable, Logger } from "@nestjs/common";
import { withRetry } from "../common/retry";
import {
  SourceUnavailableError,
  type CallStats,
  type ConnectorType,
  type ResolvedSource,
  type SourceConnector,
  type SourceHost,
  type SourceOverview,
  type SourcePartition,
  type SourceVps,
} from "../connectors/connector.types";
import {
  mapCallStats,
  mapDashboard,
  mapHost,
  mapPartition,
  mapVps,
  type ServerwareCallStatsRaw,
  type ServerwareDashboardRaw,
  type ServerwareEnvelope,
  type ServerwareHost,
  type ServerwareHostRaw,
  type ServerwarePartition,
  type ServerwarePartitionRaw,
  type ServerwareVps,
  type ServerwareVpsRaw,
} from "./serverware.types";

const REQUEST_TIMEOUT_MS = 10_000;

interface ServerwareSourceConfig {
  baseUrl: string;
  netId: number;
}

interface ServerwareSourceCredentials {
  apiToken: string;
}

function readConfig(source: ResolvedSource): ServerwareSourceConfig {
  const { baseUrl, netId } = source.config as Partial<ServerwareSourceConfig>;
  if (!baseUrl || typeof netId !== "number") {
    throw new SourceUnavailableError(source.key, "missing config.baseUrl / config.netId");
  }
  return { baseUrl, netId };
}

function readCredentials(source: ResolvedSource): ServerwareSourceCredentials {
  const { apiToken } = source.credentials as Partial<ServerwareSourceCredentials>;
  if (!apiToken) {
    throw new SourceUnavailableError(source.key, "missing credentials.apiToken");
  }
  return { apiToken };
}

function toSourceHost(h: ServerwareHost): SourceHost {
  return {
    sourceHostId: h.serverwareHostId,
    uuid: h.uuid,
    name: h.name,
    purpose: h.purpose,
    state: h.state,
    online: h.online,
    connected: h.connected,
    cpuUsage: h.cpuUsage,
    memUsage: h.memUsage,
    memTotal: h.memTotal,
    vpsCount: h.vpsCount,
    vpsRunning: h.vpsRunning,
  };
}

function toSourceVps(v: ServerwareVps): SourceVps {
  return {
    sourceVpsId: v.serverwareVpsId,
    uuid: v.uuid,
    hostId: v.hostId,
    partitionId: v.partitionId,
    name: v.name,
    engine: v.engine,
    state: v.state,
    task: v.task,
    memLimit: v.memLimit,
    cpuLimit: v.cpuLimit,
    cpuShare: v.cpuShare,
    ioLimit: v.ioLimit,
    diskState: v.diskState,
    cpuUsage: v.cpuUsage,
    memUsage: v.memUsage,
    diskUsage: v.diskUsage,
    ccCount: v.ccCount,
    pbxwareVersion: v.pbxwareVersion,
    collectMetrics: v.collectMetrics,
    ipAddresses: v.ipAddresses,
    uptimeSeconds: v.uptimeSeconds,
  };
}

function toSourcePartition(p: ServerwarePartition): SourcePartition {
  return {
    sourcePartitionId: p.serverwarePartitionId,
    uuid: p.uuid,
    name: p.name,
    company: p.company,
    crmLink: p.crmLink,
    vpsQuota: p.vpsQuota,
    vpsUsage: p.vpsUsage,
  };
}

/**
 * SourceConnector implementation for ServerWare's sw-wcp REST surface. Knows
 * nothing about our MySQL schema - SyncService owns persistence. Unlike the
 * old env-config version, every call takes a ResolvedSource (decrypted
 * config+credentials resolved by SourcesService) rather than looking a
 * cluster up by key internally - this class holds no state of its own.
 */
@Injectable()
export class ServerwareService implements SourceConnector {
  readonly connectorType: ConnectorType = "serverware";
  private readonly logger = new Logger(ServerwareService.name);

  async listHosts(source: ResolvedSource): Promise<SourceHost[]> {
    const config = readConfig(source);
    const raw = await this.request<ServerwareHostRaw[]>(
      source,
      config,
      `/api/networks/${config.netId}/hosts`,
    );
    return raw.map(mapHost).map(toSourceHost);
  }

  async listVpses(source: ResolvedSource): Promise<SourceVps[]> {
    const config = readConfig(source);
    const raw = await this.request<ServerwareVpsRaw[]>(
      source,
      config,
      `/api/networks/${config.netId}/vpses`,
    );
    return raw.map(mapVps).map(toSourceVps);
  }

  async listPartitions(source: ResolvedSource): Promise<SourcePartition[]> {
    const config = readConfig(source);
    const raw = await this.request<ServerwarePartitionRaw[]>(
      source,
      config,
      `/api/networks/${config.netId}/partitions`,
    );
    return raw.map(mapPartition).map(toSourcePartition);
  }

  async getCallStats(source: ResolvedSource): Promise<CallStats> {
    const config = readConfig(source);
    const raw = await this.request<ServerwareCallStatsRaw>(
      source,
      config,
      `/api/networks/${config.netId}/dashboard/vps-call-stats`,
    );
    return mapCallStats(raw);
  }

  async getOverview(source: ResolvedSource): Promise<SourceOverview> {
    const config = readConfig(source);
    const raw = await this.request<ServerwareDashboardRaw>(
      source,
      config,
      `/api/networks/${config.netId}/dashboard`,
    );
    const dashboard = mapDashboard(raw);
    return {
      domainCount: dashboard.domainCount,
      hostCount: dashboard.hostCount,
      vpsCount: dashboard.vpsCount,
      vpsRunning: dashboard.vpsRunning,
      concurrentCalls: dashboard.ccCount,
      callsThisHour: dashboard.callStatsCurrHour,
      memTotalGb: dashboard.memHostsTotalKb / 1024 / 1024,
      memCommittedGb: dashboard.memVpsesCommittedMb / 1024,
      storageTotalGb: dashboard.storHostsTotalGb,
      storageCommittedGb: dashboard.storVpsesCommittedGb,
    };
  }

  /**
   * Write actions - gated by project policy, explicit sign-off obtained
   * (see hst2171-architecture). Deliberately NOT wrapped in retry (see
   * performAction) - a retried restart after an ambiguous timeout could
   * double-fire against real infrastructure.
   */
  async startVps(source: ResolvedSource, sourceVpsId: number): Promise<void> {
    await this.performAction(source, sourceVpsId, "start");
  }

  async stopVps(source: ResolvedSource, sourceVpsId: number): Promise<void> {
    await this.performAction(source, sourceVpsId, "stop");
  }

  async restartVps(source: ResolvedSource, sourceVpsId: number): Promise<void> {
    await this.performAction(source, sourceVpsId, "restart");
  }

  private async performAction(
    source: ResolvedSource,
    sourceVpsId: number,
    action: "start" | "stop" | "restart",
  ): Promise<void> {
    const config = readConfig(source);
    const { apiToken } = readCredentials(source);
    const path = `/api/networks/${config.netId}/vpses/${sourceVpsId}/${action}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      // No automatic retry here - per "Never assume a VPS's state changed
      // just because this platform sent an API call" (SERVERWARE_API.md
      // §0), the caller must re-read state afterward anyway, so we don't
      // compound that with blind retries on an action whose first attempt
      // may or may not have actually landed.
      //
      // Confirmed live (2026-11-15): this endpoint needs a JSON body, even
      // an empty one - a bodyless POST 500s with "JSON payload is empty".
      // A successful call returns 202 with NO response body at all, unlike
      // every read endpoint's {status, data} envelope - so this does not
      // go through the shared doFetch/envelope parsing.
      const response = await fetch(`${config.baseUrl}${path}`, {
        method: "POST",
        headers: {
          "SW-API-Token": apiToken,
          "Content-Type": "application/json",
        },
        body: "{}",
        signal: controller.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`HTTP ${response.status} from ${source.key}${path}: ${text}`);
      }
    } catch (error) {
      throw new SourceUnavailableError(source.key, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private async request<T>(
    source: ResolvedSource,
    config: ServerwareSourceConfig,
    path: string,
  ): Promise<T> {
    try {
      return await withRetry(
        () => this.doFetch<T>(source, config, path),
        {
          retries: 3,
          onRetry: (error, attempt) =>
            this.logger.warn(
              `Retry ${attempt} for ${source.key}${path}: ${String(error)}`,
            ),
        },
      );
    } catch (error) {
      // Never let a raw network/parse error reach the caller - always a
      // typed "unavailable", per hst2171-serverware-api: "Failed API call ->
      // Unknown/stale, never silently Stopped".
      throw new SourceUnavailableError(source.key, error);
    }
  }

  private async doFetch<T>(
    source: ResolvedSource,
    config: ServerwareSourceConfig,
    path: string,
  ): Promise<T> {
    const { apiToken } = readCredentials(source);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(`${config.baseUrl}${path}`, {
        headers: { "SW-API-Token": apiToken },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${source.key}${path}`);
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
