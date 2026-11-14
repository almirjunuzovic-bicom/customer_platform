/**
 * A failed ServerWare call must surface as "unknown/stale", never be
 * confused with a real state like "stopped" - this is the one error type
 * callers (the future SyncModule) should catch to decide that.
 */
export class ServerwareUnavailableError extends Error {
  constructor(
    public readonly clusterKey: string,
    public readonly cause: unknown,
  ) {
    super(`ServerWare cluster "${clusterKey}" unavailable: ${String(cause)}`);
    this.name = "ServerwareUnavailableError";
  }
}

export class ServerwareUnknownClusterError extends Error {
  constructor(clusterKey: string) {
    super(`No ServerWare config for cluster "${clusterKey}"`);
    this.name = "ServerwareUnknownClusterError";
  }
}
