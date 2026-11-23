import { Inject, Injectable } from "@nestjs/common";
import { AwsLightsailService } from "../aws/aws.service";
import { ServerwareService } from "../serverware/serverware.service";
import type { ConnectorType, SourceConnector } from "./connector.types";
import { UnsupportedConnector } from "./unsupported.connector";

/**
 * One place that knows which connectorType maps to which implementation.
 * Adding a real Proxmox connector later is: write the class, implement
 * SourceConnector, swap its UnsupportedConnector entry here for it - nothing
 * else (SyncService, VpsController) needs to change.
 */
@Injectable()
export class ConnectorRegistryService {
  private readonly connectors: Map<ConnectorType, SourceConnector>;

  constructor(
    @Inject(ServerwareService) serverwareConnector: ServerwareService,
    @Inject(AwsLightsailService) awsConnector: AwsLightsailService,
  ) {
    this.connectors = new Map<ConnectorType, SourceConnector>([
      ["serverware", serverwareConnector],
      ["aws", awsConnector],
      ["proxmox", new UnsupportedConnector("proxmox")],
    ]);
  }

  get(connectorType: ConnectorType): SourceConnector {
    const connector = this.connectors.get(connectorType);
    if (!connector) throw new Error(`Unknown connector type "${connectorType}"`);
    return connector;
  }
}
