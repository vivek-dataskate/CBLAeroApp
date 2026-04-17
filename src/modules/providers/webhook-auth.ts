import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { WebhookAuthStrategy } from './types';

/** Case-insensitive header lookup. */
function getHeader(headers: Record<string, string>, name: string): string {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) return headers[key];
  }
  return '';
}

/**
 * Compare two strings in constant time regardless of length.
 * Both inputs are first SHA-256'd to a fixed 32-byte digest before
 * `timingSafeEqual`, so length-mismatched inputs don't leak timing info
 * via an early-return. This is the standard defense for signature comparison
 * against length-probing attacks.
 *
 * The rehash is ~1µs overhead — negligible for one-per-webhook validation.
 */
function safeByteEqual(a: string, b: string): boolean {
  const digestA = createHash('sha256').update(a, 'utf-8').digest();
  const digestB = createHash('sha256').update(b, 'utf-8').digest();
  return timingSafeEqual(digestA, digestB);
}

/**
 * Validates inbound webhooks via a static bearer token in the Authorization header.
 */
export class BearerTokenWebhookAuth implements WebhookAuthStrategy {
  constructor(private readonly expectedToken: string) {
    if (!expectedToken || expectedToken.length === 0) {
      throw new Error('BearerTokenWebhookAuth: expectedToken must be non-empty');
    }
  }

  async validate(_payload: string | Buffer, headers: Record<string, string>): Promise<boolean> {
    const auth = getHeader(headers, 'authorization');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!token) return false;
    return safeByteEqual(token, this.expectedToken);
  }
}

/**
 * Validates inbound webhooks via HMAC signature.
 * The provider signs the raw body and sends the signature in a configurable header.
 */
export class HmacSignatureWebhookAuth implements WebhookAuthStrategy {
  constructor(
    private readonly secret: string,
    private readonly signatureHeader: string = 'x-signature',
    private readonly algorithm: string = 'sha256',
    /** Optional prefix on the signature value, e.g. "sha256=" */
    private readonly signaturePrefix: string = '',
  ) {
    if (!secret || secret.length === 0) {
      throw new Error('HmacSignatureWebhookAuth: secret must be non-empty');
    }
  }

  async validate(payload: string | Buffer, headers: Record<string, string>): Promise<boolean> {
    const raw = typeof payload === 'string' ? Buffer.from(payload, 'utf-8') : payload;
    const receivedSig = getHeader(headers, this.signatureHeader);
    if (!receivedSig) return false;

    const computed = this.signaturePrefix + createHmac(this.algorithm, this.secret).update(raw).digest('hex');
    return safeByteEqual(computed, receivedSig);
  }
}

/**
 * Validates inbound webhooks via a static API key in a configurable header.
 */
export class ApiKeyWebhookAuth implements WebhookAuthStrategy {
  constructor(
    private readonly expectedKey: string,
    private readonly headerName: string = 'x-api-key',
  ) {
    if (!expectedKey || expectedKey.length === 0) {
      throw new Error('ApiKeyWebhookAuth: expectedKey must be non-empty');
    }
  }

  async validate(_payload: string | Buffer, headers: Record<string, string>): Promise<boolean> {
    const key = getHeader(headers, this.headerName);
    if (!key) return false;
    return safeByteEqual(key, this.expectedKey);
  }
}
