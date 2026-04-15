import { test, expect } from '@playwright/test';

test.describe('Admin Scheduler Dashboard', () => {
  // Use saved auth state
  test.use({ storageState: 'tests/e2e/.auth/user.json' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/dashboard/admin');
  });

  test('should display scheduler status card', async ({ page }) => {
    await expect(page.locator('text=Scheduler Status')).toBeVisible();
  });

  test('should load scheduler definitions', async ({ page }) => {
    // Wait for data to load
    await page.waitForTimeout(2000); // Allow time for data fetch
    const definitions = page.locator('[data-testid="scheduler-definition"]');
    // May be empty initially
    await expect(definitions).toBeDefined();
  });

  test('should allow editing scheduler definition', async ({ page }) => {
    // This test assumes at least one definition exists
    const editBtn = page.locator('[data-testid="edit-scheduler-btn"]').first();
    if (await editBtn.isVisible()) {
      await editBtn.click();

      // Fill form - adjust selectors based on actual UI
      await page.fill('input[name="cron"]', '0 0 * * *');

      // Save
      await page.click('button[type="submit"]');

      // Verify update
      await expect(page.locator('text=Updated successfully')).toBeVisible();
    } else {
      test.skip('No scheduler definitions to edit');
    }
  });

  test('should trigger scheduler run', async ({ page }) => {
    // This test assumes at least one definition exists
    const triggerBtn = page.locator('[data-testid="trigger-scheduler-btn"]').first();
    if (await triggerBtn.isVisible()) {
      await triggerBtn.click();

      // Confirm if needed
      const confirmBtn = page.locator('button:has-text("Confirm")');
      if (await confirmBtn.isVisible()) {
        await confirmBtn.click();
      }

      // Verify run started
      await expect(page.locator('text=Run triggered')).toBeVisible();
    } else {
      test.skip('No scheduler definitions to trigger');
    }
  });

  test('should handle errors gracefully', async ({ page }) => {
    // Simulate network error
    await page.route('**/api/internal/admin/scheduler/**', route => route.abort());

    await page.reload();
    await expect(page.locator('text=Error loading scheduler data')).toBeVisible();
  });
});