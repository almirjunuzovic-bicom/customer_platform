import { SetMetadata } from "@nestjs/common";
import type { UserRole } from "./auth.types";

export const ROLES_KEY = "roles";

/** Combine with RolesGuard (after JwtAuthGuard - needs request.user set). */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
