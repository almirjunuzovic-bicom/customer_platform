/**
 * Per-cluster config, loaded from env vars - one cluster != all clusters
 * (see SERVERWARE_API.md §0: each cluster has its own base URL and token).
 *
 * Env shape:
 *   SERVERWARE_CLUSTER_KEYS=lon1,cork1
 *   SERVERWARE_LON1_BASE_URL=https://uk-lon1.bicomsystems.com
 *   SERVERWARE_LON1_API_TOKEN=srw_...
 */
export interface ServerwareClusterConfig {
  key: string;
  baseUrl: string;
  apiToken: string;
  netId: number;
}

export function loadClusterConfigs(
  env: NodeJS.ProcessEnv = process.env,
): ServerwareClusterConfig[] {
  const keys = (env.SERVERWARE_CLUSTER_KEYS ?? "")
    .split(",")
    .map((k) => k.trim())
    .filter(Boolean);

  return keys.map((key) => {
    const prefix = `SERVERWARE_${key.toUpperCase()}`;
    const baseUrl = env[`${prefix}_BASE_URL`];
    const apiToken = env[`${prefix}_API_TOKEN`];
    const netId = Number(env[`${prefix}_NET_ID`] ?? 1);

    if (!baseUrl || !apiToken) {
      throw new Error(
        `Missing ${prefix}_BASE_URL or ${prefix}_API_TOKEN for cluster "${key}"`,
      );
    }
    return { key, baseUrl, apiToken, netId };
  });
}
