export interface JwtPayload {
  sub: number; // user id
  email: string;
  name: string;
  tokenVersion: number;
}

export interface AuthenticatedUser {
  id: number;
  email: string;
  name: string;
}
