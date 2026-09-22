export type RetryOptions = {
  attempts?: number;
  baseDelayMs?: number;
  signal?: AbortSignal;
};

/** Retry transient infrastructure calls; cancellation and the final error are preserved. */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const baseDelayMs = options.baseDelayMs ?? 100;
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    if (options.signal?.aborted) throw options.signal.reason ?? new Error('Operation aborted');
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt === attempts || options.signal?.aborted) throw error;
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, baseDelayMs * 2 ** (attempt - 1));
        options.signal?.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(options.signal?.reason ?? new Error('Operation aborted'));
        }, { once: true });
      });
    }
  }
  throw lastError;
}
