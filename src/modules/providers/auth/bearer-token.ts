import type { AuthStrategy } from '../types';

/**
 * Injects a static bearer token into the Authorization header.
 */
export class BearerTokenAuth implements AuthStrategy {
  constructor(private readonly token: string) {
    if (!token || token.length === 0) {
      throw new Error('BearerTokenAuth: token must be non-empty');
    }
  }

  async applyAuth(headers: Record<string, string>): Promise<Record<string, string>> {
    headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }
}
