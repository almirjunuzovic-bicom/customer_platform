import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";
import { getToken, onUnauthorized, setToken as persistToken } from "./token";

interface AuthUser {
  id: number;
  email: string;
  name: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// No /auth/me-on-load validation yet (deliberately simple, test phase) - an
// expired/invalid stored token just means the next API call 401s. That 401
// is caught centrally in api.ts's request() (notifyUnauthorized()), which
// this subscribes to below - not left to each page to notice on its own
// query/mutation (confirmed as a real gap: only VpsList did this before,
// so a 401 on Topology/Sources/VpsDetail just showed a raw error screen).
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [hasToken, setHasToken] = useState(() => Boolean(getToken()));

  async function login(email: string, password: string) {
    const { token, user } = await api.login(email, password);
    persistToken(token);
    setUser(user);
    setHasToken(true);
  }

  function logout() {
    persistToken(null);
    setUser(null);
    setHasToken(false);
  }

  useEffect(() => onUnauthorized(logout), []);

  return (
    <AuthContext.Provider value={{ user, isAuthenticated: hasToken, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
