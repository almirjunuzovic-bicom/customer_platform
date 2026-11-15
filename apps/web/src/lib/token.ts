const STORAGE_KEY = "hosting_platform_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private browsing / blocked storage - just means "logged out"
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(STORAGE_KEY, token);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore - nothing we can do if storage is blocked
  }
}

// Tiny pub/sub so api.ts's request() - which runs outside any React
// component - can tell AuthProvider "the token just got rejected" without
// every page having to notice a 401 on its own query/mutation and call
// logout() itself. Previously only VpsList did this, so a 401 anywhere
// else (Topology, Sources, VpsDetail) just showed a raw error screen
// instead of returning to login.
type UnauthorizedListener = () => void;
let unauthorizedListeners: UnauthorizedListener[] = [];

export function onUnauthorized(listener: UnauthorizedListener): () => void {
  unauthorizedListeners.push(listener);
  return () => {
    unauthorizedListeners = unauthorizedListeners.filter((l) => l !== listener);
  };
}

export function notifyUnauthorized(): void {
  for (const listener of unauthorizedListeners) listener();
}
