/**
 * Small exponential-backoff retry helper. Used instead of a dependency
 * (p-retry@9 is pure ESM and needs Node >=22; not worth the friction for
 * this few lines of logic - see feedback-latest-versions memory).
 */
export interface RetryOptions {
  retries: number;
  minDelayMs: number;
  maxDelayMs: number;
  /** Called before each retry attempt (not the first try). */
  onRetry?: (error: unknown, attempt: number) => void;
}

const DEFAULT_OPTIONS: RetryOptions = {
  retries: 3,
  minDelayMs: 200,
  maxDelayMs: 2000,
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: unknown;

  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(
        opts.minDelayMs * 2 ** (attempt - 1),
        opts.maxDelayMs,
      );
      opts.onRetry?.(lastError, attempt);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    try {
      return await fn();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}
