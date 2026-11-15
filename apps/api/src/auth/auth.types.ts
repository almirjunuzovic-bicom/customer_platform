export type UserRole = "admin" | "staff";

export interface JwtPayload {
  sub: number; // user id
  email: string;
  name: string;
  tokenVersion: number;
}

// `role` deliberately NOT embedded in the JWT itself - like tokenVersion,
// it's re-read from the DB on every request (see AuthService.verifyToken),
// so a role change takes effect on the user's very next request instead of
// waiting out the token's full lifetime.
export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}
