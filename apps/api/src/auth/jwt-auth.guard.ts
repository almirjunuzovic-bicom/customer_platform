import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import type { Request } from "express";
import { AuthService } from "./auth.service";

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private readonly authService: AuthService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;

    if (!token) {
      throw new UnauthorizedException("Missing bearer token");
    }

    // Attach the resolved user for @CurrentUser() to read - whatever logs
    // someone in later (Google SSO, etc.) just needs to populate this same
    // shape, nothing downstream needs to change.
    (request as Request & { user?: unknown }).user = this.authService.verifyToken(token);
    return true;
  }
}
