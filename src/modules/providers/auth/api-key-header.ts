import type { AuthStrategy } from '../types';

/**
 * Injects an API key into a configurable header name.
 * Default header: X-API-Key
 */
export class ApiKeyHeaderAuth implements AuthStrategy {
  constructor(
    private readonly apiKey: string,
    private readonly headerName: string = 'X-API-Key',
  ) {}

  async applyAuth(headers: Record<string, string>): Promise<Record<string, string>> {
    headers[this.headerName] = this.apiKey;
    return headers;
  }
}
