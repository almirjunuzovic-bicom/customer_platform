import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { api, type UserRole } from "./api";
import { getToken, onUnauthorized, setToken as persistToken } from "./token";

interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: UserRole;
}

interface AuthContextValue {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

// A 401 anywhere is caught centrally in api.ts's request() (notifyUnauthorized()),
// which this subscribes to below - not left to each page to notice on its
// own query/mutation (confirmed as a real gap: only VpsList did this
// before, so a 401 on Topology/Sources/VpsDetail just showed a raw error
// screen instead of returning to login).
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

  // A stored token survives a page reload, but `user` (role included) does
  // not - without this, an admin would silently lose their admin-only
  // buttons on every refresh until logging out and back in. A failed call
  // here (expired/invalid token) 401s, which notifyUnauthorized already
  // turns into logout() above.
  useEffect(() => {
    if (hasToken && !user) {
      api.me().then(setUser).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasToken]);

  return (
    <AuthContext.Provider
      value={{ user, isAuthenticated: hasToken, isAdmin: user?.role === "admin", login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
