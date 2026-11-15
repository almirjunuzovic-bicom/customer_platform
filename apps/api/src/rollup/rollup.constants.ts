export const ROLLUP_QUEUE = "metrics-rollup";
export const ROLLUP_JOB_NAME = "rollup-metrics";
export const ROLLUP_SCHEDULER_ID = "rollup-metrics-scheduler";
// Doesn't need to be tight like the 10s sync poll - this is maintenance,
// not live data. 5 minutes keeps the raw table from growing much past
// what the 1h raw-retention tier implies between runs.
export const ROLLUP_INTERVAL_MS = 5 * 60 * 1000;

export interface RollupTier {
  bucketSeconds: number;
  /** null = this tier's source is the raw vps_metrics_history table. */
  sourceBucketSeconds: number | null;
  /** Age at which source rows for this tier are collapsed into it and the source rows pruned. */
  olderThanSeconds: number;
}

// User-specified tiering (see hst2171-architecture): raw 10s kept 1h, then
// progressively coarser. The last tier (3600s/1h, kept forever past 7d) is
// never itself rolled up further - "all time" stays at 1h resolution.
export const ROLLUP_TIERS: RollupTier[] = [
  { bucketSeconds: 180, sourceBucketSeconds: null, olderThanSeconds: 3600 }, // raw -> 3min after 1h
  { bucketSeconds: 600, sourceBucketSeconds: 180, olderThanSeconds: 6 * 3600 }, // 3min -> 10min after 6h
  { bucketSeconds: 1800, sourceBucketSeconds: 600, olderThanSeconds: 24 * 3600 }, // 10min -> 30min after 24h
  { bucketSeconds: 3600, sourceBucketSeconds: 1800, olderThanSeconds: 7 * 86400 }, // 30min -> 1h after 7d
];
