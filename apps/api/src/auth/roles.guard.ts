import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Request } from "express";
import type { AuthenticatedUser, UserRole } from "./auth.types";
import { ROLES_KEY } from "./roles.decorator";

/**
 * Must run AFTER JwtAuthGuard (reads request.user, which only JwtAuthGuard
 * sets) - always pair them: @UseGuards(JwtAuthGuard, RolesGuard). A route
 * with no @Roles() is left open to any authenticated user, same as before
 * this existed.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles || requiredRoles.length === 0) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthenticatedUser }>();
    const user = request.user;
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException(
        `Requires ${requiredRoles.join(" or ")} role`,
      );
    }
    return true;
  }
}
