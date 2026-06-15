// Cache the result of an async initializer so it runs at most once per process —
// but DROP the cache if it rejects, so the next caller retries. Without the
// reset, a single transient failure on the first run (cold serverless instance,
// pool/connect timeout) would leave a permanently-rejected promise cached and
// brick every later caller until the process is recycled.
export function cacheUntilFailure<T>(factory: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    if (!cached) {
      cached = factory().catch((error) => {
        cached = null;
        throw error;
      });
    }
    return cached;
  };
}

// Run an async operation, retrying on rejection up to `attempts` times with a
// fixed delay between tries. Used to make a best-effort cross-system write (e.g.
// a Clerk metadata update that runs AFTER a Postgres commit) survive transient
// 5xx/network blips, so the two systems don't drift on one unlucky request.
export async function withRetries<T>(
  factory: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const delayMs = options.delayMs ?? 150;
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await factory();
    } catch (error) {
      lastError = error;
      if (attempt < attempts && delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError;
}
