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
