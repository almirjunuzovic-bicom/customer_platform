import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import jwt from "jsonwebtoken";
import { DATABASE, type Database } from "../db/database.module";
import { users } from "../db/schema";
import type { AuthenticatedUser, JwtPayload } from "./auth.types";

const JWT_EXPIRY = "7d"; // short-lived-ish for a test-phase, single-token setup

// Basic brute-force guard - in-memory, per-process (fine for the current
// single-instance deployment, see hst2171-architecture; would need a
// shared store like Redis if this ever runs as more than one API process).
// Keyed by email, not IP - this is an internal tool with no self-registration
// (a small, known set of accounts), so protecting a specific account against
// repeated guesses matters more here than rate-limiting by source address.
const LOGIN_ATTEMPT_LIMIT = 5;
const LOGIN_ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

interface LoginAttemptRecord {
  count: number;
  windowStartedAt: number;
}

@Injectable()
export class AuthService {
  private readonly jwtSecret: string;
  private readonly loginAttempts = new Map<string, LoginAttemptRecord>();

  constructor(@Inject(DATABASE) private readonly db: Database) {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
      throw new Error("JWT_SECRET env var is required");
    }
    this.jwtSecret = secret;
  }

  async login(email: string, password: string): Promise<{ token: string; user: AuthenticatedUser }> {
    const attemptKey = email.toLowerCase();
    this.assertNotRateLimited(attemptKey);

    const [user] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Same error for "no such user" and "wrong password" - don't leak which
    // one it was.
    if (!user || !(await compare(password, user.passwordHash))) {
      this.recordFailedAttempt(attemptKey);
      throw new UnauthorizedException("Invalid email or password");
    }
    this.loginAttempts.delete(attemptKey);

    await this.db
      .update(users)
      .set({ lastLoginAt: new Date() })
      .where(eq(users.id, user.id));

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      name: user.name,
      tokenVersion: user.tokenVersion,
    };
    const token = jwt.sign(payload, this.jwtSecret, { expiresIn: JWT_EXPIRY });

    return { token, user: { id: user.id, email: user.email, name: user.name } };
  }

  // Async on purpose - checks the token's version against the CURRENT value
  // in the DB, not just the signature/expiry, so a revoked token (see
  // revoke-user.manual.ts) stops working immediately rather than waiting
  // out its full 7-day lifetime.
  async verifyToken(token: string): Promise<AuthenticatedUser> {
    let payload: JwtPayload;
    try {
      payload = jwt.verify(token, this.jwtSecret) as unknown as JwtPayload;
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    const [user] = await this.db
      .select({ tokenVersion: users.tokenVersion })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user || user.tokenVersion !== payload.tokenVersion) {
      throw new UnauthorizedException("Token has been revoked");
    }

    return { id: payload.sub, email: payload.email, name: payload.name };
  }

  private assertNotRateLimited(attemptKey: string): void {
    const record = this.loginAttempts.get(attemptKey);
    if (!record) return;
    if (Date.now() - record.windowStartedAt >= LOGIN_ATTEMPT_WINDOW_MS) {
      this.loginAttempts.delete(attemptKey);
      return;
    }
    if (record.count >= LOGIN_ATTEMPT_LIMIT) {
      throw new HttpException(
        "Too many failed login attempts - try again later",
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private recordFailedAttempt(attemptKey: string): void {
    const now = Date.now();
    const record = this.loginAttempts.get(attemptKey);
    if (!record || now - record.windowStartedAt >= LOGIN_ATTEMPT_WINDOW_MS) {
      this.loginAttempts.set(attemptKey, { count: 1, windowStartedAt: now });
    } else {
      record.count += 1;
    }
  }
}
