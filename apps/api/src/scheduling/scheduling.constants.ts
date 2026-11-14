export const SYNC_QUEUE = "serverware-sync";
export const SYNC_JOB_NAME = "sync-cluster";
/** How often each cluster is polled - see hst2171-architecture: confirmed
 * safe against sw-wcp (plain SQL read, no rate limiter server-side). */
export const SYNC_INTERVAL_MS = 10_000;
