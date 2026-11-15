import { createContext, useContext, useState, type ReactNode } from "react";
import { api } from "./api";
import { getToken, setToken as persistToken } from "./token";

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
// expired/invalid stored token just means the next API call 401s and
// logout() gets called from there (see App.tsx's query error handling).
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
