import { Injectable, Logger } from "@nestjs/common";
import {
  SourceUnavailableError,
  type CallStats,
  type ConnectorType,
  type CustomerInfoFields,
  type ResolvedSource,
  type SourceConnector,
  type SourceHost,
  type SourceOverview,
  type SourcePartition,
  type SourceVps,
  type VpsIdentity,
} from "../connectors/connector.types";
import { signLightsailRequest } from "./aws-sigv4";
import {
  TAG_KEY_CUSTOMER_ID,
  TAG_KEY_CUSTOMER_NAME,
  TAG_KEY_HOSTING_PACKAGE,
  TAG_KEY_NOTIFICATION_EMAILS,
  toSourceHost,
  toSourceVps,
  type LightsailGetInstanceMetricDataResponse,
  type LightsailGetInstancesResponse,
  type LightsailInstanceRaw,
} from "./aws.types";

const REQUEST_TIMEOUT_MS = 10_000;

interface AwsSourceConfig {
  regions: string[];
}

interface AwsSourceCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

function readConfig(source: ResolvedSource): AwsSourceConfig {
  const { regions } = source.config as Partial<AwsSourceConfig>;
  if (!Array.isArray(regions) || regions.length === 0) {
    throw new SourceUnavailableError(source.key, "missing config.regions (non-empty string array)");
  }
  return { regions };
}

function readCredentials(source: ResolvedSource): AwsSourceCredentials {
  const { accessKeyId, secretAccessKey } = source.credentials as Partial<AwsSourceCredentials>;
  if (!accessKeyId || !secretAccessKey) {
    throw new SourceUnavailableError(
      source.key,
      "missing credentials.accessKeyId / credentials.secretAccessKey",
    );
  }
  return { accessKeyId, secretAccessKey };
}

function isRunning(raw: LightsailInstanceRaw): boolean {
  return raw.state.name.toLowerCase() === "running";
}

/**
 * SourceConnector implementation for AWS Lightsail - hand-signed SigV4 over
 * fetch (see aws-sigv4.ts), ported from Bicom's internal AWS Monitor tool
 * (confirmed working live against real Lightsail accounts). See aws.types.ts
 * for the host/partition/identity mapping rationale - no cluster-wide
 * endpoint exists like SERVERware's dashboard, so every method here works
 * off the same GetInstances listing, fetched independently per call (no
 * caching layer - acceptable for the fleet sizes this targets, same
 * tradeoff the reference implementation made).
 */
@Injectable()
export class AwsLightsailService implements SourceConnector {
  readonly connectorType: ConnectorType = "aws";
  private readonly logger = new Logger(AwsLightsailService.name);

  async listHosts(source: ResolvedSource): Promise<SourceHost[]> {
    const { regions } = readConfig(source);
    const creds = readCredentials(source);
    const byRegion = await this.fetchAllInstances(source, creds, regions);
    return regions.map((region) => toSourceHost(region, byRegion.get(region) ?? []));
  }

  async listPartitions(_source: ResolvedSource): Promise<SourcePartition[]> {
    return [];
  }

  async listVpses(source: ResolvedSource): Promise<SourceVps[]> {
    const { regions } = readConfig(source);
    const creds = readCredentials(source);
    const byRegion = await this.fetchAllInstances(source, creds, regions);
    const result: SourceVps[] = [];
    for (const [region, instances] of byRegion) {
      for (const instance of instances) {
        const cpuUsage = await this.cpuUsageNow(source, creds, region, instance.name).catch((error) => {
          this.logger.warn(`CPU metric fetch failed for ${region}:${instance.name}: ${String(error)}`);
          return null;
        });
        result.push(toSourceVps(instance, region, cpuUsage));
      }
    }
    return result;
  }

  async getCallStats(source: ResolvedSource): Promise<CallStats> {
    throw new SourceUnavailableError(
      source.key,
      "AWS Lightsail has no call-stats concept (not a PBXware platform)",
    );
  }

  async getOverview(source: ResolvedSource): Promise<SourceOverview> {
    const { regions } = readConfig(source);
    const creds = readCredentials(source);
    const byRegion = await this.fetchAllInstances(source, creds, regions);
    let vpsCount = 0;
    let vpsRunning = 0;
    let memTotalKb = 0;
    for (const instances of byRegion.values()) {
      vpsCount += instances.length;
      vpsRunning += instances.filter(isRunning).length;
      memTotalKb += instances.reduce((sum, i) => sum + (i.hardware?.ramSizeInGb ?? 0) * 1024 * 1024, 0);
    }
    return {
      domainCount: 0,
      hostCount: regions.length,
      vpsCount,
      vpsRunning,
      concurrentCalls: 0,
      callsThisHour: 0,
      memTotalGb: memTotalKb / 1024 / 1024,
      memCommittedGb: memTotalKb / 1024 / 1024,
      storageTotalGb: 0,
      storageCommittedGb: 0,
    };
  }

  /**
   * Write actions - deliberately NOT wrapped in retry, same policy as
   * serverware.service.ts: a retried Start/Stop/Reboot after an ambiguous
   * timeout could double-fire against real infrastructure.
   */
  async startVps(source: ResolvedSource, vps: VpsIdentity): Promise<void> {
    await this.performAction(source, vps, "StartInstance");
  }

  async stopVps(source: ResolvedSource, vps: VpsIdentity): Promise<void> {
    await this.performAction(source, vps, "StopInstance");
  }

  async restartVps(source: ResolvedSource, vps: VpsIdentity): Promise<void> {
    await this.performAction(source, vps, "RebootInstance");
  }

  /**
   * Write-back half of the tag <-> customerId/customerName/hostingPackage/
   * notificationEmails sync (read half: aws.types.ts toSourceVps). A `null`
   * field removes that tag (UntagResource); a non-null one sets it
   * (TagResource) - batched into at most one call each, not one call per
   * field. Never touches the unrelated "Description" tag (see aws.types.ts).
   */
  async pushCustomerInfo(
    source: ResolvedSource,
    vps: VpsIdentity,
    fields: CustomerInfoFields,
  ): Promise<void> {
    const creds = readCredentials(source);
    const { region, instanceName } = this.splitUuid(source, vps.uuid);
    // Lightsail tag VALUES reject "," (confirmed live: "A specified tag
    // value contains invalid characters... letters, spaces, and numbers...
    // + - = . _ : / @") - space-separated instead, not comma-separated like
    // the UI's own input field (see VpsDetail.tsx CustomerCard).
    const emailsValue =
      fields.notificationEmails && fields.notificationEmails.length > 0
        ? fields.notificationEmails.join(" ")
        : null;
    const desired: Record<string, string | null> = {
      [TAG_KEY_CUSTOMER_ID]: fields.customerId,
      [TAG_KEY_CUSTOMER_NAME]: fields.customerName,
      [TAG_KEY_HOSTING_PACKAGE]: fields.hostingPackage,
      [TAG_KEY_NOTIFICATION_EMAILS]: emailsValue,
    };
    const toSet = Object.entries(desired).filter(
      (entry): entry is [string, string] => !!entry[1],
    );
    const toClear = Object.entries(desired)
      .filter(([, value]) => !value)
      .map(([key]) => key);

    if (toSet.length > 0) {
      await this.request(source, creds, region, "TagResource", {
        resourceName: instanceName,
        tags: toSet.map(([key, value]) => ({ key, value })),
      });
    }
    if (toClear.length > 0) {
      await this.request(source, creds, region, "UntagResource", {
        resourceName: instanceName,
        tagKeys: toClear,
      });
    }
  }

  /**
   * `vps.sourceVpsId` is only a hash (see aws.types.ts) - the real
   * (region, instanceName) identity Start/Stop/RebootInstance need lives in
   * `vps.uuid`. Lightsail instance names can't contain ":" (alphanumeric,
   * hyphen, underscore, period only), so it's a safe separator.
   */
  private splitUuid(source: ResolvedSource, uuid: string): { region: string; instanceName: string } {
    const sep = uuid.indexOf(":");
    if (sep < 0) {
      throw new SourceUnavailableError(
        source.key,
        `malformed AWS VPS uuid "${uuid}" (expected "region:instanceName")`,
      );
    }
    return { region: uuid.slice(0, sep), instanceName: uuid.slice(sep + 1) };
  }

  private async performAction(
    source: ResolvedSource,
    vps: VpsIdentity,
    action: "StartInstance" | "StopInstance" | "RebootInstance",
  ): Promise<void> {
    const creds = readCredentials(source);
    const { region, instanceName } = this.splitUuid(source, vps.uuid);
    await this.request(source, creds, region, action, { instanceName });
  }

  /** Latest CPU% = average of the last 15 minutes - Lightsail has no "current" snapshot endpoint. */
  private async cpuUsageNow(
    source: ResolvedSource,
    creds: AwsSourceCredentials,
    region: string,
    instanceName: string,
  ): Promise<number | null> {
    const now = Math.floor(Date.now() / 1000);
    const response = await this.request<LightsailGetInstanceMetricDataResponse>(
      source,
      creds,
      region,
      "GetInstanceMetricData",
      {
        instanceName,
        metricName: "CPUUtilization",
        period: 300,
        startTime: now - 900,
        endTime: now,
        unit: "Percent",
        statistics: ["Average"],
      },
    );
    const points = (response.metricData ?? []).slice().sort((a, b) => a.timestamp - b.timestamp);
    const last = points.at(-1);
    return last?.average ?? null;
  }

  /** Fetches every instance across every configured region, keyed by region. */
  private async fetchAllInstances(
    source: ResolvedSource,
    creds: AwsSourceCredentials,
    regions: string[],
  ): Promise<Map<string, LightsailInstanceRaw[]>> {
    const byRegion = new Map<string, LightsailInstanceRaw[]>();
    for (const region of regions) {
      const response = await this.request<LightsailGetInstancesResponse>(
        source,
        creds,
        region,
        "GetInstances",
        {},
      );
      byRegion.set(region, response.instances ?? []);
    }
    return byRegion;
  }

  private async request<T>(
    source: ResolvedSource,
    creds: AwsSourceCredentials,
    region: string,
    action: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const signed = signLightsailRequest(creds.accessKeyId, creds.secretAccessKey, region, action, params);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(signed.url, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
        signal: controller.signal,
      });
      const json = await response.json().catch(() => ({}));
      if (!response.ok) {
        const message = (json as { message?: string }).message ?? `HTTP ${response.status}`;
        throw new Error(`Lightsail ${action} in ${region} failed: ${message}`);
      }
      return json as T;
    } catch (error) {
      throw new SourceUnavailableError(source.key, error);
    } finally {
      clearTimeout(timeout);
    }
  }
}
