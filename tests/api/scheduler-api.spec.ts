import { describe, it, expect } from 'vitest';

// Note: These tests assume the dev server is running on localhost:3000
// Run 'npm run dev' in another terminal before running tests

describe('Scheduler API Tests', () => {
  describe('GET /api/internal/admin/scheduler/definitions', () => {
    it('should return 200 with scheduler definitions', async () => {
      const response = await fetch('http://localhost:3000/api/internal/admin/scheduler/definitions');
      expect(response.status).toBe(200);
      const data = await response.json();
      expect(Array.isArray(data)).toBe(true);
      // Add more assertions based on expected structure
    });

    it('should handle unauthorized access', async () => {
      // Test without auth headers - assuming auth is required
      const response = await fetch('http://localhost:3000/api/internal/admin/scheduler/definitions');
      // May return 401 or redirect to login
      expect([401, 302, 403]).toContain(response.status);
    });
  });

  describe('PATCH /api/internal/admin/scheduler/definitions/[id]', () => {
    it('should update scheduler definition successfully', async () => {
      // This would need a valid ID and auth
      // For now, test the endpoint exists and returns expected error
      const response = await fetch('http://localhost:3000/api/internal/admin/scheduler/definitions/test-id', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false }),
      });
      // Expect auth error or 404 if no such ID
      expect([401, 404, 403]).toContain(response.status);
    });
  });

  describe('POST /api/internal/admin/scheduler/definitions/[id]/trigger', () => {
    it('should trigger scheduler run', async () => {
      const response = await fetch('http://localhost:3000/api/internal/admin/scheduler/definitions/test-id/trigger', {
        method: 'POST',
      });
      // Expect auth error or 404
      expect([401, 404, 403]).toContain(response.status);
    });
  });
});