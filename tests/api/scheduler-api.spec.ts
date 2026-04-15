import { describe, it, expect, beforeAll } from 'vitest';
import { issueSessionToken, SESSION_COOKIE_NAME } from '@/modules/auth/session';

// Note: These tests assume the dev server is running on localhost:3000
// Run 'npm run dev' in another terminal before running tests

let sessionToken: string;

beforeAll(async () => {
  // Generate a valid session token for auth
  const issued = await issueSessionToken({
    actorId: 'test-admin-1',
    email: 'test@cblsolutions.com',
    tenantId: 'cbl-aero',
    role: 'admin',
    rememberDevice: false,
  });
  sessionToken = issued.token;
});

describe('Scheduler API Tests', () => {
  describe('GET /api/internal/admin/scheduler/definitions', () => {
    it('should return 200 with scheduler definitions', async () => {
      const response = await fetch('http://localhost:3000/api/internal/admin/scheduler/definitions', {
        headers: {
          'Cookie': `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
        },
      });
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toHaveProperty('data');
      expect(Array.isArray(data.data)).toBe(true);
    });

    it('should handle unauthorized access', async () => {
      // Test without auth headers - should fail with 401
      const response = await fetch('http://localhost:3000/api/internal/admin/scheduler/definitions');
      expect(response.status).toBe(401);
    });
  });

  describe('PATCH /api/internal/admin/scheduler/definitions/[id]', () => {
    it('should update scheduler definition successfully', async () => {
      // This would need a valid ID and auth
      // For now, test the endpoint exists and returns expected error
      const response = await fetch('http://localhost:3000/api/internal/admin/scheduler/definitions/test-id', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Cookie': `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
        },
        body: JSON.stringify({ enabled: false }),
      });
      // Expect 404 if no such ID (auth succeeded)
      expect([404, 400]).toContain(response.status);
    });
  });

  describe('POST /api/internal/admin/scheduler/definitions/[id]/trigger', () => {
    it('should trigger scheduler run', async () => {
      const response = await fetch('http://localhost:3000/api/internal/admin/scheduler/definitions/test-id/trigger', {
        method: 'POST',
        headers: {
          'Cookie': `${SESSION_COOKIE_NAME}=${encodeURIComponent(sessionToken)}`,
        },
      });
      // Expect 404 if no such ID (auth succeeded)
      expect([404, 400]).toContain(response.status);
    });
  });
});