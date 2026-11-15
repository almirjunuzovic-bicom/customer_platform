import {
  BadGatewayException,
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from "@nestjs/common";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { ConnectorRegistryService } from "./connector-registry.service";
import { CONNECTOR_TYPES, SourceUnavailableError, type ConnectorType } from "./connector.types";
import { SourcesService } from "./sources.service";

interface CreateSourceBody {
  key?: string;
  name?: string;
  connectorType?: string;
  config?: Record<string, unknown>;
  credentials?: Record<string, unknown>;
}

interface UpdateSourceBody {
  enabled?: boolean;
}

function parseIdParam(id: string): number {
  const n = Number(id);
  if (!Number.isInteger(n)) throw new BadRequestException(`"id" must be an integer`);
  return n;
}

function assertConnectorType(value: string | undefined): ConnectorType {
  if (!value || !CONNECTOR_TYPES.includes(value as ConnectorType)) {
    throw new BadRequestException(
      `"connectorType" must be one of: ${CONNECTOR_TYPES.join(", ")}`,
    );
  }
  return value as ConnectorType;
}

/**
 * Admin-only mechanism for adding/managing infrastructure sources
 * (SERVERware clusters, later AWS accounts / Proxmox nodes) - see
 * connectors/connector.types.ts and hst2171-architecture. Never returns
 * credentials: SourcesService.resolve() (the only place they're decrypted)
 * is internal-only, not reachable over this API.
 */
@Controller("sources")
@UseGuards(JwtAuthGuard)
export class SourcesController {
  constructor(
    private readonly sourcesService: SourcesService,
    private readonly connectorRegistry: ConnectorRegistryService,
  ) {}

  @Get()
  async list() {
    return this.sourcesService.list();
  }

  /**
   * Network-wide call volume (current_hour/today/yesterday/week/month) -
   * not per-VPS, see connector.types.ts CallStats. ServerWare/PBXware-
   * specific; connectors that don't have this throw, mapped to 502 here
   * same as any other "can't reach/support this right now" case.
   */
  @Get(":id/call-stats")
  async callStats(@Param("id") id: string) {
    try {
      const resolved = await this.sourcesService.resolve(parseIdParam(id));
      const connector = this.connectorRegistry.get(resolved.connectorType);
      return await connector.getCallStats(resolved);
    } catch (error) {
      if (error instanceof SourceUnavailableError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }

  /** Cluster-wide "how's it doing" summary - see connector.types.ts SourceOverview. */
  @Get(":id/overview")
  async overview(@Param("id") id: string) {
    try {
      const resolved = await this.sourcesService.resolve(parseIdParam(id));
      const connector = this.connectorRegistry.get(resolved.connectorType);
      return await connector.getOverview(resolved);
    } catch (error) {
      if (error instanceof SourceUnavailableError) {
        throw new BadGatewayException(error.message);
      }
      throw error;
    }
  }

  @Post()
  async create(@Body() body: CreateSourceBody) {
    if (!body.key || !body.name) {
      throw new BadRequestException(`"key" and "name" are required`);
    }
    const connectorType = assertConnectorType(body.connectorType);
    if (!body.config || typeof body.config !== "object") {
      throw new BadRequestException(`"config" must be an object`);
    }
    if (!body.credentials || typeof body.credentials !== "object") {
      throw new BadRequestException(`"credentials" must be an object`);
    }
    return this.sourcesService.upsert({
      key: body.key,
      name: body.name,
      connectorType,
      config: body.config,
      credentials: body.credentials,
    });
  }

  @Patch(":id")
  async update(@Param("id") id: string, @Body() body: UpdateSourceBody) {
    if (typeof body.enabled !== "boolean") {
      throw new BadRequestException(`"enabled" (boolean) is the only field this endpoint supports right now`);
    }
    return this.sourcesService.setEnabled(parseIdParam(id), body.enabled);
  }
}
