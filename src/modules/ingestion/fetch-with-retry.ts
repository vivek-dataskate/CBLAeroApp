/**
 * Fetch wrapper with exponential backoff retry for external API calls.
 * Retries on network errors and 429/5xx responses.
 */
export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: { maxRetries?: number; baseDelayMs?: number }
): Promise<Response> {
  const maxRetries = options?.maxRetries ?? 3;
  const baseDelay = options?.baseDelayMs ?? 1000;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      // Don't retry client errors (4xx) except 429 (rate limited)
      if (response.ok || (response.status >= 400 && response.status < 500 && response.status !== 429)) {
        return response;
      }

      // Retry on 429 or 5xx
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[fetchWithRetry] ${response.status} on attempt ${attempt + 1}, retrying in ${delay}ms...`);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }

      return response; // Return the failed response on final attempt
    } catch (err) {
      // Network error (DNS, timeout, etc.)
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt);
        console.warn(`[fetchWithRetry] Network error on attempt ${attempt + 1}, retrying in ${delay}ms:`, err instanceof Error ? err.message : err);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }

  // Unreachable, but TypeScript needs it
  throw new Error('fetchWithRetry: exhausted retries');
}
