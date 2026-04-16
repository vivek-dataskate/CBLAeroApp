import type {
  ProviderConfig,
  ProviderCallResult,
  ErrorClassification,
  ProviderLogEntry,
  CostContext,
} from './types';

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BACKOFF_MS = 1_000;
/**
 * Default retryable HTTP statuses.
 * Matches `fetchWithRetry` (408 timeout + 429 rate-limit + 5xx server errors)
 * with one deliberate exclusion: 501 Not Implemented is permanent — retrying
 * a server that explicitly does not implement the endpoint is pure waste.
 */
const DEFAULT_RETRYABLE_STATUSES = [408, 429, 500, 502, 503, 504];

/** Heuristic: errors thrown during auth setup should classify as auth_failure. */
const AUTH_ERROR_PATTERNS = [
  /oauth/i,
  /auth/i,
  /token/i,
  /credential/i,
  /invalid_client/i,
  /invalid_grant/i,
];

export interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  parseJson?: boolean;
  /** Provider-specific metadata passed to estimateCost (e.g. model, tokens). */
  costMeta?: Record<string, unknown>;
  /** External abort signal (from caller's request context). */
  signal?: AbortSignal;
}

/**
 * Base outbound HTTP client for all external providers.
 *
 * Provides: auth injection, timeout, retry with exponential backoff,
 * structured logging, error classification, cost tracking, health reporting.
 *
 * Architecture ref: architecture.md §25 — BaseProviderClient
 */
export class BaseProviderClient {
  private readonly name: string;
  private readonly baseUrl: string;
  private readonly config: Required<
    Pick<ProviderConfig, 'timeoutMs' | 'maxRetries' | 'backoffMs' | 'retryableStatuses'>
  > &
    Pick<ProviderConfig, 'auth' | 'estimateCost'>;

  public onLog: (entry: ProviderLogEntry) => void = () => {};
  public onSuccess: (durationMs: number) => void = () => {};
  public onFailure: (durationMs: number, classification: ErrorClassification) => void = () => {};

  constructor(config: ProviderConfig) {
    if ((config.maxRetries ?? DEFAULT_MAX_RETRIES) < 0) {
      throw new Error(`BaseProviderClient: maxRetries must be >= 0 (got ${config.maxRetries})`);
    }
    if ((config.timeoutMs ?? DEFAULT_TIMEOUT_MS) <= 0) {
      throw new Error(`BaseProviderClient: timeoutMs must be > 0`);
    }

    this.name = config.name;
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.config = {
      auth: config.auth,
      timeoutMs: config.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: config.maxRetries ?? DEFAULT_MAX_RETRIES,
      backoffMs: config.backoffMs ?? DEFAULT_BACKOFF_MS,
      retryableStatuses: config.retryableStatuses ?? DEFAULT_RETRYABLE_STATUSES,
      estimateCost: config.estimateCost,
    };
  }

  async request<T = unknown>(
    method: string,
    path: string,
    options?: RequestOptions,
  ): Promise<ProviderCallResult<T>> {
    const parseJson = options?.parseJson !== false;
    let lastResult: ProviderCallResult<T> | null = null;

    for (let attempt = 1; attempt <= this.config.maxRetries + 1; attempt++) {
      const start = Date.now();
      let status: number | null = null;
      let classification: ErrorClassification | null = null;
      let errorMsg: string | undefined;

      // Timeout controller is set up outside the fetch's try so it covers
      // BOTH time-to-headers AND time-to-complete-body (Patch 4).
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      const externalSignal = options?.signal;
      const onExternalAbort = () => controller.abort();
      if (externalSignal) {
        if (externalSignal.aborted) controller.abort();
        else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
      }

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          ...options?.headers,
        };
        await this.config.auth.applyAuth(headers);

        const url = `${this.baseUrl}${path}`;
        const response = await fetch(url, {
          method,
          headers,
          body: options?.body != null ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });

        status = response.status;

        if (response.ok) {
          // parseJson uses controller.signal indirectly — if body streaming hangs,
          // the timeout still fires and controller aborts, causing .text() to throw.
          const data = parseJson ? (await safeParseJson<T>(response)) : (null as T);
          const durationMs = Date.now() - start;
          this.emitLog({
            provider: this.name,
            method,
            path,
            statusCode: status,
            durationMs,
            attempt,
          }, options?.costMeta);
          this.onSuccess(durationMs);
          return { ok: true, status, data, errorClassification: null, durationMs, attempt };
        }

        const durationMs = Date.now() - start;
        classification = classifyError(status);
        errorMsg = `HTTP ${status}`;
        this.emitLog(
          {
            provider: this.name, method, path, statusCode: status,
            durationMs, attempt, error: errorMsg, errorClassification: classification,
          },
          options?.costMeta,
        );

        lastResult = {
          ok: false, status, data: null,
          errorClassification: classification,
          durationMs, attempt, error: errorMsg,
        };

        // Per-attempt health tracking (decision 1A)
        this.onFailure(durationMs, classification);

        if (!this.config.retryableStatuses.includes(status)) {
          return lastResult;
        }

        if (attempt <= this.config.maxRetries) {
          await sleep(this.config.backoffMs * Math.pow(2, attempt - 1));
        }
      } catch (err) {
        const durationMs = Date.now() - start;
        const isAbort =
          (err instanceof DOMException && err.name === 'AbortError') ||
          (err as Error)?.name === 'AbortError';
        const isAuthError = !isAbort && looksLikeAuthError(err);

        // Patch 1: classify auth-setup failures as auth_failure, not transient.
        // This prevents OAuth/token-refresh failures from burning all retry
        // attempts under the wrong classification.
        classification = isAbort
          ? 'transient'
          : isAuthError
            ? 'auth_failure'
            : 'transient';

        errorMsg = isAbort
          ? `Timeout after ${this.config.timeoutMs}ms`
          : err instanceof Error
            ? err.message
            : String(err);

        this.emitLog(
          {
            provider: this.name, method, path, statusCode: null,
            durationMs, attempt, error: errorMsg, errorClassification: classification,
          },
          options?.costMeta,
        );

        lastResult = {
          ok: false, status: 0, data: null,
          errorClassification: classification,
          durationMs, attempt, error: errorMsg,
        };

        this.onFailure(durationMs, classification);

        // Don't retry auth failures — the credential is broken, not the network.
        if (classification === 'auth_failure') {
          return lastResult;
        }

        if (attempt <= this.config.maxRetries) {
          await sleep(this.config.backoffMs * Math.pow(2, attempt - 1));
        }
      } finally {
        clearTimeout(timeout);
        if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
      }
    }

    return lastResult!;
  }

  get<T = unknown>(path: string, headers?: Record<string, string>) {
    return this.request<T>('GET', path, { headers });
  }

  post<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('POST', path, { body, headers });
  }

  put<T = unknown>(path: string, body?: unknown, headers?: Record<string, string>) {
    return this.request<T>('PUT', path, { body, headers });
  }

  delete<T = unknown>(path: string, headers?: Record<string, string>) {
    return this.request<T>('DELETE', path, { headers });
  }

  private emitLog(entry: ProviderLogEntry, costMeta?: Record<string, unknown>): void {
    if (this.config.estimateCost) {
      const ctx: CostContext = {
        method: entry.method,
        path: entry.path,
        statusCode: entry.statusCode,
        durationMs: entry.durationMs,
        costMeta,
      };
      try {
        entry.costEstimate = this.config.estimateCost(ctx);
      } catch {
        // Cost estimation must never break the request pipeline.
      }
    }
    this.onLog(entry);
  }
}

function classifyError(status: number): ErrorClassification {
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_failure';
  if (status >= 500) return 'transient';
  return 'permanent';
}

function looksLikeAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return AUTH_ERROR_PATTERNS.some((re) => re.test(msg));
}

/**
 * Parse response body as JSON, safely handling empty bodies and non-JSON content.
 * Returns null for empty bodies (common 200-ack pattern) instead of throwing.
 */
async function safeParseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text || text.trim().length === 0) return null as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null as T;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
