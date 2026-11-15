import type {
  ConnectorType,
  ResolvedSource,
  SourceConnector,
  SourceHost,
  SourcePartition,
  SourceVps,
} from "./connector.types";
import { SourceUnavailableError } from "./connector.types";

/**
 * Placeholder for a connector type that's a known future provider (aws,
 * proxmox - see hst2171-architecture) but has no real implementation yet.
 * A source can be created with this connectorType today (the mechanism
 * doesn't need to wait on the connector), it just fails every sync/action
 * with a clear, specific error instead of the registry resolving to the
 * wrong connector or crashing with an unrelated one.
 */
export class UnsupportedConnector implements SourceConnector {
  constructor(public readonly connectorType: ConnectorType) {}

  async listHosts(source: ResolvedSource): Promise<SourceHost[]> {
    throw this.notImplemented(source);
  }

  async listVpses(source: ResolvedSource): Promise<SourceVps[]> {
    throw this.notImplemented(source);
  }

  async listPartitions(source: ResolvedSource): Promise<SourcePartition[]> {
    throw this.notImplemented(source);
  }

  async startVps(source: ResolvedSource): Promise<void> {
    throw this.notImplemented(source);
  }

  async stopVps(source: ResolvedSource): Promise<void> {
    throw this.notImplemented(source);
  }

  async restartVps(source: ResolvedSource): Promise<void> {
    throw this.notImplemented(source);
  }

  private notImplemented(source: ResolvedSource): SourceUnavailableError {
    return new SourceUnavailableError(
      source.key,
      `connector type "${this.connectorType}" is not implemented yet`,
    );
  }
}
